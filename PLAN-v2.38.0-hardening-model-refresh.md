# Plan implementare v2.38.0 — Hardening + Model Refresh

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livreaza v2.38.0: elimina stack-ul OpenRouter chinezesc, migreaza Claude Opus 4.6 → 4.8 si Gemini 3 Flash → 3.5 Flash, plus pachetul de hardening validat (ack gate, sameSite Strict, JWT revocation, validare OPENROUTER_MODEL_OVERRIDES, cap sedinte/parti, disclaimer AI, latenta in ai_usage).

**Architecture:** Cinci workstream-uri secventiale pe un singur branch (`feat/v2.38.0-hardening-model-refresh`): (A) model refresh + eliminare chinese stack (backend + frontend + manual), (D) AI hardening marunt (atinge aceleasi fisiere ca A, deci imediat dupa), (B) deploy hardening (ack gate + cookie), (C) JWT revocation cu tabela `jwt_denylist`, (F) reziduale mici confirmate din audit-urile 2026-05-22 / 2026-06-02. Trei migratii SQLite aditive in ordinea executiei (0036 data-fix stack, 0037 coloane ai_usage, 0038 tabela jwt_denylist) — fara rebuild de tabele.

**Tech Stack:** Node 22 + Hono + better-sqlite3 (backend CJS via esbuild), React 18 + Vite (frontend), vitest, biome.

---

## Fapte verificate (nu re-verifica, sunt confirmate la 2026-06-12)

| Fapt | Valoare |
|------|---------|
| Model ID nativ Opus 4.8 | `claude-opus-4-8` |
| Pricing Opus 4.8 (nativ si OpenRouter) | $5 input / $25 output per 1M tokens |
| Slug OpenRouter Opus 4.8 | `anthropic/claude-opus-4.8` |
| Model ID nativ Gemini 3.5 Flash | `gemini-3.5-flash` (stable, fara sufix preview) |
| Pricing Gemini 3.5 Flash (nativ si OpenRouter) | $1.50 input / $9 output per 1M tokens |
| Slug OpenRouter Gemini 3.5 Flash | `google/gemini-3.5-flash` |
| Migratii | auto-descoperite din `backend/src/db/migrations/` (runner.ts), ultima e 0035; nu exista registru de editat |
| Cost ai_usage | calculat la INSERT (`aiUsage.ts:140`), nu la citire — stergerea intrarilor de pricing chineze NU corupe istoricul |
| `ai_usage` CHECK | pe `provider`, NU pe `model` — randurile istorice cu modele chineze raman valide |

## Decizii luate (asumptii explicite)

1. **Ack gate (Fix 1):** varianta (b) — eliminam complet cerinta `LEGAL_DASHBOARD_ACK_NO_AUTH` deoarece remote bind cere deja obligatoriu `auth_mode=web` + JWT valid (`index.ts:379-389`, fatal altfel). Ack-ul e dublu-gate redundant cu nume mincinos ("no-auth-yet" cand auth-ul exista).
2. **Chinese stack:** eliminare completa din functionalitate, dar coloana `openrouter_stack` ramane in DB (evitam rebuild); migratia 0036 coercseaza `'chinese'` → `'western'` si repository-ul scrie constant `'western'`. Conceptul de `stack` dispare din tipuri, API si UI.
3. **Cheia interna gemini:** redenumim `gemini-flash-3` → `gemini-flash-3.5` (precedent: `qwen-3.6-max` → `qwen-3.7-max` in v2.36). Cheia `claude-opus` e version-agnostic, ramane.
4. **Cap sedinte/parti:** validare hard-reject la 500 in `validateAiBody()` (nu slice silentios) — body-ul e oricum plafonat la 100KB, capul face costul predictibil si mesajul explicit.
5. **JWT denylist:** claim `jti` optional — tokenele vechi fara `jti` nu pot fi revocate individual (acceptat, TTL default 1h); expira natural.
6. **Pricing nativ Opus:** intrarea veche `claude-opus-4-6: 15/75` era gresita (pricing Opus 4.1); intrarea noua 4.8 foloseste 5/25 corect.

---

## Workstream A — Eliminare chinese stack + model refresh

### Task A1: Backend `ai.ts` — modele, sloguri, timeouts

**Files:**
- Modify: `backend/src/services/ai.ts`
- Test: `backend/src/services/ai.test.ts`, `backend/src/services/ai.openrouter.test.ts`

- [ ] **Step 1: Rescrie sectiunea de modele (liniile ~14-65)**

```ts
export type AiRouting = { mode: "native" | "openrouter" };

export const AI_MODELS: Record<string, { provider: AiUsageProvider; modelId: string }> = {
  // Anthropic
  "claude-haiku": { provider: "anthropic", modelId: "claude-haiku-4-5-20251001" },
  "claude-sonnet": { provider: "anthropic", modelId: "claude-sonnet-4-6" },
  "claude-opus": { provider: "anthropic", modelId: "claude-opus-4-8" },
  // OpenAI
  "gpt-5.4-nano": { provider: "openai", modelId: "gpt-5.4-nano" },
  "gpt-5.4-mini": { provider: "openai", modelId: "gpt-5.4-mini" },
  "gpt-5.4": { provider: "openai", modelId: "gpt-5.4" },
  // Google
  "gemini-flash-lite-3": { provider: "google", modelId: "gemini-3.1-flash-lite-preview" },
  "gemini-flash-3.5": { provider: "google", modelId: "gemini-3.5-flash" },
  "gemini-pro-3": { provider: "google", modelId: "gemini-3.1-pro-preview" },
};

export const JUDGE_MODELS = ["claude-opus", "gpt-5.4", "gemini-pro-3"];

export const OPENROUTER_MODEL_MAP: Record<string, string> = {
  "claude-haiku": "anthropic/claude-haiku-4.5",
  "claude-sonnet": "anthropic/claude-sonnet-4.6",
  "claude-opus": "anthropic/claude-opus-4.8",
  "gpt-5.4-nano": "openai/gpt-5.4-nano",
  "gpt-5.4-mini": "openai/gpt-5.4-mini",
  "gpt-5.4": "openai/gpt-5.4",
  "gemini-flash-lite-3": "google/gemini-3.1-flash-lite-preview",
  "gemini-flash-3.5": "google/gemini-3.5-flash",
  "gemini-pro-3": "google/gemini-3.1-pro-preview",
};

export function resolveOpenRouterSlug(modelKey: string): string | null {
  const override = process.env.OPENROUTER_MODEL_OVERRIDES;
  if (override) {
    const pairs = override.split(",").map((p) => p.split(":").map((s) => s.trim()));
    const hit = pairs.find(([k]) => k === modelKey);
    if (hit?.[1]) return hit[1];
  }
  return OPENROUTER_MODEL_MAP[modelKey] || null;
}
```

Sterse: `OpenRouterStack`, campul `stack` din `AI_MODELS`, `OPENROUTER_WESTERN_MAP` (redenumit `OPENROUTER_MODEL_MAP`), `OPENROUTER_CHINESE_MAP`, parametrul `stack` din `resolveOpenRouterSlug`.

- [ ] **Step 2: Sterge constantele si helperii chinese (liniile ~79-107)**

Sterge: `AI_TIMEOUT_CHINESE`, `AI_MULTI_TIMEOUT_CHINESE`, `effectiveOpenRouterTimeout()`, `AI_MAX_TOKENS_CHINESE`, `effectiveOpenRouterMaxTokens()` impreuna cu comentariile lor. Raman `AI_TIMEOUT = 120000`, `AI_MULTI_TIMEOUT = 180000`, `AI_MAX_TOKENS = 8000`.

- [ ] **Step 3: Curata thread-ul de `stack` din restul fisierului**

Ruleaza `Grep "stack" backend/src/services/ai.ts` si pentru fiecare hit ramas:
- in `callOpenRouter` (zona ~470-557): inlocuieste `effectiveOpenRouterTimeout(timeout, stack)` cu `timeout`, `effectiveOpenRouterMaxTokens(stack)` cu `AI_MAX_TOKENS`, si scoate parametrul/argumentul `stack` din semnatura si call sites.
- in `shouldRouteViaOpenRouter` (~linia 628): scoate orice referinta la stack; logica ramane: mode explicit `openrouter` sau model openrouter-only (acum nu mai exista modele openrouter-only, deci fallback-ul defensiv pe `provider === "openrouter"` devine dead code — sterge-l si actualizeaza comentariul).
- orice apel `resolveOpenRouterSlug(key, stack)` devine `resolveOpenRouterSlug(key)`.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p backend/tsconfig.json`
Expected: erori DOAR in `routes/ai.ts`, teste si `aiUsage.ts` (le rezolva A2/A3/A5) — zero erori reziduale in `ai.ts`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/ai.ts
git commit -m "feat(ai): drop chinese OpenRouter stack, bump Opus 4.8 + Gemini 3.5 Flash model ids"
```

### Task A2: Backend `routes/ai.ts` — API settings fara stack

**Files:**
- Modify: `backend/src/routes/ai.ts`
- Test: `backend/src/routes/ai.settings.test.ts`, `backend/src/routes/ai.contract.test.ts`

- [ ] **Step 1: Schema si raspunsuri**

La linia ~31: `openrouter_stack: z.enum(["western", "chinese"])` — sterge campul din schema PUT (ramane doar `mode`). La liniile ~112, ~127, ~147: scoate `openrouter_stack`/`stack` din obiectele returnate; `getRouting()` returneaza `{ mode: settings.mode }`.

- [ ] **Step 2: Sterge logica de stack purity**

Sterge `assertStackPurity()` (~linia 119), check-ul per-model `selectedModel.stack !== routing.stack` (~liniile 188-189) si blocul `STACK_MIX_FORBIDDEN` (~liniile 304-308).

- [ ] **Step 3: Mesajul de judge**

Linia ~283:
```ts
"Model judecator nepermis. Doar Claude Opus 4.8, GPT-5.4 si Gemini 3.1 Pro."
```

- [ ] **Step 4: Adapteaza testele**

In `ai.settings.test.ts`: scoate `openrouter_stack` din payload-urile PUT si din expectarile de raspuns; sterge testele care valideaza `"chinese"` ca valoare acceptata (inlocuieste cu un test ca PUT `{ mode: "openrouter" }` e suficient). In `ai.contract.test.ts`: actualizeaza orice referinta la `claude-opus-4-6` → `claude-opus-4-8` si la mesajul de judge.

- [ ] **Step 5: Ruleaza testele atinse**

Run: `npm test --workspace=backend -- ai.settings ai.contract`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/ai.ts backend/src/routes/ai.settings.test.ts backend/src/routes/ai.contract.test.ts
git commit -m "feat(ai): drop openrouter_stack from settings API and stack purity checks"
```

### Task A3: Repository + migratia 0036

**Files:**
- Modify: `backend/src/db/ownerAiSettingsRepository.ts`
- Create: `backend/src/db/migrations/0036_openrouter_stack_western.up.sql`
- Create: `backend/src/db/migrations/0036_openrouter_stack_western.down.sql`
- Test: `backend/src/db/ownerAiSettingsRepository.test.ts`

- [ ] **Step 1: Migratia 0036**

`0036_openrouter_stack_western.up.sql`:
```sql
-- v2.38.0: stack-ul chinezesc OpenRouter eliminat din aplicatie.
-- Coloana openrouter_stack ramane in schema (evitam rebuild); valorile
-- legacy 'chinese' se coercseaza la 'western'.
UPDATE owner_ai_settings SET openrouter_stack = 'western' WHERE openrouter_stack = 'chinese';
```

`0036_openrouter_stack_western.down.sql` (conventie repo: orice down STERGE versiunea din `_schema_versions` — vezi `downSchemaVersions.test.ts`; copiaza blocul defensiv din header-ul lui `0035_audit_log_ts_index.down.sql`):
```sql
-- Data-fix ireversibil (nu putem sti care owneri aveau 'chinese'). No-op pe date.
DELETE FROM _schema_versions WHERE version = 36;
```

- [ ] **Step 2: Simplifica repository-ul**

`ownerAiSettingsRepository.ts` — forma finala a partilor schimbate:
```ts
export type AiProviderMode = "native" | "openrouter";

export interface OwnerAiSettings {
  owner_id: string;
  mode: AiProviderMode;
  updated_at: number;
}

export interface UpsertOwnerAiSettingsInput {
  mode: AiProviderMode;
}

const COLUMNS = "owner_id, mode, updated_at";
```
Sterge `OpenRouterStack`, `assertStack()`, campul din `toDomain`/`getSettings` (defaultul devine `{ owner_id, mode: "native", updated_at: 0 }`). In `upsertSettings`, INSERT-ul scrie literal `'western'`:
```ts
`INSERT INTO owner_ai_settings
   (owner_id, mode, openrouter_stack, updated_at)
 VALUES (?, ?, 'western', ?)
 ON CONFLICT(owner_id) DO UPDATE SET
   mode = excluded.mode,
   openrouter_stack = excluded.openrouter_stack,
   updated_at = excluded.updated_at`
```

- [ ] **Step 3: Adapteaza testele repository**

In `ownerAiSettingsRepository.test.ts`: scoate `openrouter_stack` din inputuri/expectari; adauga un test ca dupa upsert coloana DB contine `'western'` (citire raw cu `getDb().prepare("SELECT openrouter_stack FROM owner_ai_settings WHERE owner_id = ?")`).

- [ ] **Step 4: Run + commit**

Run: `npm test --workspace=backend -- ownerAiSettings`
Expected: PASS.

```bash
git add backend/src/db/ownerAiSettingsRepository.ts backend/src/db/ownerAiSettingsRepository.test.ts backend/src/db/migrations/0036_openrouter_stack_western.up.sql backend/src/db/migrations/0036_openrouter_stack_western.down.sql
git commit -m "feat(db): migration 0036 — coerce openrouter_stack chinese->western, drop stack from repository API"
```

### Task A4: Pricing `aiUsage.ts`

**Files:**
- Modify: `backend/src/services/aiUsage.ts` (liniile ~34-64)
- Test: `backend/src/services/aiUsage.test.ts`

- [ ] **Step 1: Actualizeaza `MODEL_PRICES_USD_PER_MILLION`**

```ts
  anthropic: {
    "claude-haiku-4-5-20251001": { inputUsdPerMillion: 1, outputUsdPerMillion: 5 },
    "claude-sonnet-4-6": { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
    "claude-opus-4-8": { inputUsdPerMillion: 5, outputUsdPerMillion: 25 },
  },
```
In `google`: inlocuieste `"gemini-3-flash-preview"` cu `"gemini-3.5-flash": { inputUsdPerMillion: 1.5, outputUsdPerMillion: 9 }`. In `openrouter`: `"anthropic/claude-opus-4.6"` → `"anthropic/claude-opus-4.8": { 5, 25 }`, `"google/gemini-3-flash-preview"` → `"google/gemini-3.5-flash": { 1.5, 9 }`, sterge `"z-ai/glm-5.1"`, `"moonshotai/kimi-k2.6"`, `"qwen/qwen3.7-max"`. Istoricul `ai_usage` nu e afectat (cost stocat la insert).

- [ ] **Step 2: `AiUsageRoutingTag` — scoate varianta chinese (Codex finding #1)**

`backend/src/db/aiUsageRepository.ts:5`: tipul e `"native" | "openrouter:western" | "openrouter:chinese"`. Ingusteaza la `"native" | "openrouter:western"` — pastram formatul emis `openrouter:western` ca sa nu atingem nicio constrangere/asteptare DB; randurile istorice cu `openrouter:chinese` raman in DB si sunt doar citite (verifica intai cu Grep ca nu exista CHECK pe `routing_tag` in migratii — daca exista, nu emite valori noi). Actualizeaza orice loc din `backend/src/services/ai.ts` care construia tag-ul din stack. Adapteaza `aiUsageRepository.test.ts:72-76` si `aiUsage.test.ts:123-159`.

- [ ] **Step 3: Adapteaza `aiUsage.test.ts`**

Orice test care foloseste model id chinezesc sau `claude-opus-4-6`/`gemini-3-flash-preview` trece pe noile id-uri; un model chinezesc devine caz de test pentru fallback-ul "missing price → cost 0 + warn".

- [ ] **Step 4: Run + commit**

Run: `npm test --workspace=backend -- aiUsage`
Expected: PASS.

```bash
git add backend/src/services/aiUsage.ts backend/src/services/aiUsage.test.ts backend/src/db/aiUsageRepository.ts backend/src/db/aiUsageRepository.test.ts
git commit -m "feat(ai): pricing table refresh — Opus 4.8 (5/25), Gemini 3.5 Flash (1.5/9), drop chinese entries + routing tag"
```

### Task A5: Frontend — config modele, settings hook, dialog, timeout

**Files:**
- Modify: `frontend/src/components/dosare-ai-config.ts`
- Modify: `frontend/src/hooks/useAiSettings.ts`
- Modify: `frontend/src/components/ApiKeyDialog.tsx` (liniile ~149-174)
- Modify: `frontend/src/lib/api.ts` (linia ~347)
- Test: `frontend/src/components/dosare-ai-config.test.ts`, `frontend/src/components/ApiKeyDialog.test.tsx`, `frontend/src/components/DosareTable.test.tsx`

- [ ] **Step 1: `dosare-ai-config.ts`**

Sterge `stack` din `AiModelDef` si tipul `OpenRouterStack`. In `AI_MODELS`: sterge cele 3 intrari chineze; `claude-opus` label devine `"Opus 4.8"`; intrarea gemini mid devine:
```ts
{ key: "gemini-flash-3.5", label: "3.5 Flash", provider: "google", desc: "Echilibrat", color: "blue" },
```
In `JUDGE_MODELS_LIST`: sterge cele 3 chineze; `claude-opus` label devine `"Claude Opus 4.8"`. Sterge functiile `availableModels()` si `availableJudgeModels()`; consumatorii lor sunt direct `frontend/src/hooks/useDosareAi.ts:3-9` (import cu alias) si `:93-94` (apeluri) — inlocuieste cu `AI_MODELS` respectiv `JUDGE_MODELS_LIST`.

Lista completa de fisiere frontend atinse de disparitia `stack`/`OpenRouterStack` (enumerare Codex, verifica fiecare): `useAiSettings.ts:3-18,69-81`, `ApiKeyDialog.tsx:149-174`, `ApiKeyDialog.test.tsx:83-105,202-231`, `App.tsx:191`, `DosareTable.tsx:24,53`, `DosareTable.test.tsx:112-116`, `pages/Dosare.tsx:14,111`, `useDosareAi.ts:60-63,93-94`, `dosare-ai-config.test.ts:2-34`.

- [ ] **Step 2: `useAiSettings.ts`**

```ts
export interface AiSettings {
  mode: AiMode;
}

const DEFAULT_SETTINGS: AiSettings = { mode: "native" };

function parseSettings(value: unknown): AiSettings {
  if (!value || typeof value !== "object") return DEFAULT_SETTINGS;
  const row = value as Partial<AiSettings>;
  return { mode: row.mode === "openrouter" ? "openrouter" : "native" };
}
```
Sterge `setStack` si `stack` din obiectul returnat; import-ul `OpenRouterStack` dispare.

- [ ] **Step 3: `ApiKeyDialog.tsx`**

Sterge integral blocul toggle Vestic/Chinezesc (`{aiSettings.mode === "openrouter" && (...)}`, liniile ~149-174). Butoanele Native/OpenRouter raman.

- [ ] **Step 4: `api.ts` timeout analyze-multi**

Linia ~347:
```ts
signal: AbortSignal.timeout(420000), // 7 min — analysts in paralel (cap 180s fiecare) + judge dupa (cap 180s) = 360s worst case, plus 60s margine retea
```

- [ ] **Step 5: Sanity pe chei persistate**

Ruleaza `Grep "gemini-flash-3|glm-5.1|kimi-k2.6|qwen-3.7-max" frontend/src --glob "!**/*.test.*"` si rezolva fiecare hit ramas (selectii default, localStorage, etc.). Daca exista persistare localStorage de model key, coerceaza cheile necunoscute la default (`claude-sonnet` analist, `claude-opus` judge) la citire.

- [ ] **Step 6: Adapteaza testele frontend**

`dosare-ai-config.test.ts`: scoate expectarile de stack/chinese, verifica noile labels. `ApiKeyDialog.test.tsx`: sterge testele toggle-ului de stack. `DosareTable.test.tsx`: label `Opus 4.6` → `Opus 4.8`, `3 Flash` → `3.5 Flash` unde apare.

- [ ] **Step 7: Run + commit**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: PASS.

```bash
git add frontend/src
git commit -m "feat(ui): remove chinese stack toggle + model refresh Opus 4.8 / Gemini 3.5 Flash"
```

### Task A6: Manualul utilizator

**Files:**
- Modify: `frontend/src/pages/manual-content.tsx` (liniile 507, 522, 566)
- Modify: `frontend/src/lib/export-manual.ts` (liniile 348, 350, 374)

- [ ] **Step 1: Actualizeaza listele de modele**

`manual-content.tsx:507`: `"Claude Opus 4.8 — Premium (cel mai detaliat)"`. Linia 522 (lista Gemini, era stale pe 2.x): `["Gemini 3.1 Lite — Rapid", "Gemini 3.5 Flash — Echilibrat", "Gemini 3.1 Pro — Premium"]`. Linia 566: `"Modelele judecator sunt restrictionate la modele premium: Claude Opus 4.8, GPT-5.4 sau Gemini 3.1 Pro"`.

`export-manual.ts:348`: `"Anthropic (Claude): Haiku 4.5 (Rapid), Sonnet 4.6 (Echilibrat), Opus 4.8 (Premium)"`. Linia 350: `"Google (Gemini): Gemini 3.1 Lite (Rapid), Gemini 3.5 Flash (Echilibrat), Gemini 3.1 Pro (Premium)"`. Linia 374: la fel ca manual-content 566.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/manual-content.tsx frontend/src/lib/export-manual.ts
git commit -m "docs(manual): model lists refresh — Opus 4.8, Gemini 3.5 Flash, no chinese stack"
```

### Task A7: Teste backend ramase + suite completa

**Files:**
- Modify: `backend/src/services/ai.test.ts`, `backend/src/services/ai.openrouter.test.ts`, `backend/src/db/aiUsageRepository.test.ts`, `backend/src/db/migrations/0025_ai_usage_owner_default.test.ts`

- [ ] **Step 1: Adapteaza testele**

`ai.openrouter.test.ts`: testul de la linia ~102 (`OPENROUTER_MODEL_OVERRIDES` cu `qwen-3.7-max:qwen/custom`) trece pe chei western (ex. `claude-sonnet:anthropic/custom`); sterge testele de stack mixing/chinese; redenumeste importurile `OPENROUTER_WESTERN_MAP` → `OPENROUTER_MODEL_MAP`. `ai.test.ts`: model id-uri noi. Fixture-urile cu modele chineze din `aiUsageRepository.test.ts` si `0025_ai_usage_owner_default.test.ts` trec pe `anthropic/claude-sonnet-4.6` (randurile istorice raman oricum valide — CHECK-ul e pe provider).

- [ ] **Step 2: Suite completa backend + frontend**

Run: `npm test --workspace=backend && cd frontend && npm test -- --run`
Expected: PASS integral.

- [ ] **Step 3: Commit**

```bash
git add backend/src
git commit -m "test: align ai suites with chinese stack removal + new model ids"
```

---

## Workstream D — AI hardening marunt

### Task D1: Validare `OPENROUTER_MODEL_OVERRIDES`

**Files:**
- Modify: `backend/src/services/ai.ts` (functia `resolveOpenRouterSlug` din A1)
- Test: `backend/src/services/ai.openrouter.test.ts`

- [ ] **Step 1: Test failing**

```ts
it("ignora override-uri cu format invalid sau provider neacceptat", () => {
  process.env.OPENROUTER_MODEL_OVERRIDES =
    "claude-sonnet:javascript:alert(1), claude-opus:evil-provider/model, gpt-5.4:openai/custom-gpt";
  expect(resolveOpenRouterSlug("claude-sonnet")).toBe("anthropic/claude-sonnet-4.6"); // fallback static
  expect(resolveOpenRouterSlug("claude-opus")).toBe("anthropic/claude-opus-4.8"); // provider respins
  expect(resolveOpenRouterSlug("gpt-5.4")).toBe("openai/custom-gpt"); // valid, trece
});
```

Run: `npm test --workspace=backend -- ai.openrouter` → Expected: FAIL (override-urile invalide sunt acceptate).

- [ ] **Step 2: Implementare**

In `ai.ts`, deasupra `resolveOpenRouterSlug`:
```ts
// Env var = operator-trusted, dar validam fail-fast: typo-uri sau slug-uri
// in afara formatului provider/model ar produce erori criptice la OpenRouter.
const OPENROUTER_ALLOWED_PROVIDERS = new Set(["anthropic", "openai", "google"]);
const OPENROUTER_SLUG_RE = /^([\w-]+)\/[\w.:-]+$/;

function isValidOverrideSlug(slug: string): boolean {
  const match = OPENROUTER_SLUG_RE.exec(slug);
  if (!match || !OPENROUTER_ALLOWED_PROVIDERS.has(match[1])) {
    console.warn(`[ai] OPENROUTER_MODEL_OVERRIDES: slug invalid ignorat: ${slug}`);
    return false;
  }
  return true;
}
```
In `resolveOpenRouterSlug`, conditia devine: `if (hit?.[1] && isValidOverrideSlug(hit[1])) return hit[1];`

- [ ] **Step 3: Run + commit**

Run: `npm test --workspace=backend -- ai.openrouter` → Expected: PASS.

```bash
git add backend/src/services/ai.ts backend/src/services/ai.openrouter.test.ts
git commit -m "feat(ai): validate OPENROUTER_MODEL_OVERRIDES slugs against provider allowlist"
```

### Task D2: Cap pe `sedinte[]` si `parti[]` in `validateAiBody()`

**Files:**
- Modify: `backend/src/services/ai.ts` (functia `validateAiBody`, ~linia 562)
- Test: `backend/src/services/ai.test.ts`

- [ ] **Step 1: Test failing**

```ts
it("respinge dosare cu peste 500 de sedinte sau parti", () => {
  const sedinte = Array.from({ length: 501 }, (_, i) => ({ data: `2026-01-${i}`, solutie: "x" }));
  expect(validateAiBody({ dosar: { numar: "1/2/2026", sedinte } })).toMatch(/sedinte/i);
  const parti = Array.from({ length: 501 }, (_, i) => ({ nume: `P${i}`, calitateParte: "Parat" }));
  expect(validateAiBody({ dosar: { numar: "1/2/2026", parti } })).toMatch(/parti/i);
  expect(validateAiBody({ dosar: { numar: "1/2/2026", sedinte: sedinte.slice(0, 500) } })).toBeNull();
});
```

Run: `npm test --workspace=backend -- ai.test` → Expected: FAIL.

- [ ] **Step 2: Implementare**

In `validateAiBody`, dupa check-urile de Array existente:
```ts
const MAX_AI_LIST_ITEMS = 500;
```
(constanta la nivel de modul, langa `MAX_AI_BODY_SIZE`), iar in functie:
```ts
if (dosar.parti !== undefined && !Array.isArray(dosar.parti)) return "Camp parti invalid.";
if (Array.isArray(dosar.parti) && dosar.parti.length > MAX_AI_LIST_ITEMS)
  return `Prea multe parti (max ${MAX_AI_LIST_ITEMS}).`;
if (dosar.sedinte !== undefined && !Array.isArray(dosar.sedinte)) return "Camp sedinte invalid.";
if (Array.isArray(dosar.sedinte) && dosar.sedinte.length > MAX_AI_LIST_ITEMS)
  return `Prea multe sedinte (max ${MAX_AI_LIST_ITEMS}).`;
```

- [ ] **Step 3: Run + commit**

Run: `npm test --workspace=backend -- ai.test` → Expected: PASS.

```bash
git add backend/src/services/ai.ts backend/src/services/ai.test.ts
git commit -m "feat(ai): cap sedinte/parti arrays at 500 in validateAiBody"
```

### Task D3: Disclaimer AI in UI

**Files:**
- Modify: `frontend/src/components/dosare-ai-analysis-panel.tsx`

- [ ] **Step 1: Adauga constanta si randarea**

La nivel de modul:
```tsx
const AI_DISCLAIMER = "Analiza este generata de AI in scop informativ si nu constituie consultanta juridica.";
```
Dupa div-ul `prose` al analizei single (inchiderea de la ~linia 226, inca in interiorul conditiei `{ai.analysis[dosar.numar] && (...)}` — transforma in fragment):
```tsx
{ai.analysis[dosar.numar] && (
  <>
    <div className="prose prose-sm ...">...</div>
    <p className="mt-2 text-[11px] italic text-muted-foreground">{AI_DISCLAIMER}</p>
  </>
)}
```
Identic in sectiunea multi-agent: dupa containerul prose al analizei finale (~linia 477) adauga acelasi `<p>`. Doua aparitii in total.

- [ ] **Step 2: Verifica vizual + commit**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run` → Expected: PASS.

```bash
git add frontend/src/components/dosare-ai-analysis-panel.tsx
git commit -m "feat(ui): legal disclaimer under AI analysis output"
```

### Task D4: Latenta + error_type persistente in `ai_usage` (migratia 0037)

**ATENTIE numerotare (Codex finding #8):** D4 ruleaza INAINTE de Workstream C, iar runner-ul de migratii respinge gap-urile. De aceea latenta ia 0037 si `jwt_denylist` (Task C1) ia 0038.

**Files:**
- Create: `backend/src/db/migrations/0037_ai_usage_latency.up.sql`
- Create: `backend/src/db/migrations/0037_ai_usage_latency.down.sql`
- Modify: `backend/src/db/aiUsageRepository.ts`, `backend/src/services/aiUsage.ts`, `backend/src/services/ai.ts` (`withAiLogging`)
- Test: `backend/src/db/aiUsageRepository.test.ts`

- [ ] **Step 1: Migratia**

`0037_ai_usage_latency.up.sql`:
```sql
-- v2.38.0: persistam latenta si tipul de eroare per call AI (inainte doar
-- stdout JSON, nedurabil in containere).
ALTER TABLE ai_usage ADD COLUMN latency_ms INTEGER;
ALTER TABLE ai_usage ADD COLUMN error_type TEXT;
```
`0037_ai_usage_latency.down.sql` (conventie repo: include delete din `_schema_versions`):
```sql
ALTER TABLE ai_usage DROP COLUMN latency_ms;
ALTER TABLE ai_usage DROP COLUMN error_type;
DELETE FROM _schema_versions WHERE version = 37;
```

- [ ] **Step 2: Repository**

In `AiUsageRow` adauga `latency_ms: number | null;` si `error_type: string | null;`. In `InsertAiUsageInput` adauga `latencyMs?: number | null;` si `errorType?: string | null;`. In `insertAiUsage` extinde INSERT-ul cu cele doua coloane (`latency_ms, error_type` + 2 placeholders, valori `input.latencyMs ?? null`, `input.errorType ?? null`).

- [ ] **Step 3: Thread prin `aiUsage.ts` + `withAiLogging`**

In `AiUsageCallMeta` (aiUsage.ts) adauga `latencyMs?: number;` si `errorType?: string;`; `recordAiUsageSafely` le paseaza la `insertAiUsage`. In `withAiLogging` (ai.ts): pe calea de succes adauga `latencyMs: Date.now() - start` in `meta`-ul pasat la `recordAiUsageSafely`; pe calea de eroare adauga `latencyMs: Date.now() - start, errorType` in obiectul `meta` existent.

- [ ] **Step 4: Test**

In `aiUsageRepository.test.ts` adauga: insert cu `latencyMs: 1234, errorType: "timeout"` → row-ul citit contine `latency_ms: 1234, error_type: "timeout"`; insert fara ele → `null`.

Run: `npm test --workspace=backend -- aiUsage` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/migrations/0037_ai_usage_latency.* backend/src/db/aiUsageRepository.ts backend/src/db/aiUsageRepository.test.ts backend/src/services/aiUsage.ts backend/src/services/ai.ts
git commit -m "feat(db): migration 0037 — persist latency_ms + error_type per AI call"
```

---

## Workstream B — Deploy hardening

### Task B1: Eliminarea gate-ului `LEGAL_DASHBOARD_ACK_NO_AUTH`

**Files:**
- Modify: `backend/src/index.ts` (liniile ~366-410)
- Modify: `backend/src/index.test.ts`
- Modify: `deploy/docker-compose.prod.yml:94`, `docker-compose.web.example.yml` (liniile ~11, 43), `.github/workflows/docker-build.yml` (liniile ~102, 114), `.env.example:19`, `backend/.env.example:52`
- Docs: `README.md` (123-124), `SECURITY.md` (154, 204), `RUNBOOK.md` (71), `DEPLOY-SERVER.md` (144), `SESSION-HANDOFF.md` (tabel kill switches, linia ~23)

- [ ] **Step 1: index.ts**

Sterge blocul ack (liniile ~391-403) si linia `Ack acceptat` din banner. Comentariul F2 (366-372) se rescrie:
```ts
// F2 (audit 2026-04-30) + PR-9 fix B1: remote bind cere auth_mode=web cu JWT
// valid (fatal mai jos). Gate-ul istoric LEGAL_DASHBOARD_ACK_NO_AUTH a fost
// eliminat in v2.38.0 — era redundant cu cerinta de web auth si numele lui
// ("no-auth-yet") nu mai reflecta realitatea. Banner-ul ramane (audit trail).
```
Banner-ul final:
```ts
console.warn("====================================================================");
console.warn("WARNING: Legal Dashboard ruleaza pe interfata non-loopback.");
console.warn(`Auth mode: ${authMode} (JWT validation activ).`);
console.warn("Toate API-urile sunt accesibile oricarui client cu token valid.");
console.warn("====================================================================");
```

- [ ] **Step 2: Teste**

Ruleaza `Grep "ACK_NO_AUTH" backend/src/index.test.ts -n`. Sterge variabila din fixture-uri (ex. linia ~204). Testul care asserteaza boot-fail fara ack (daca exista) se transforma: remote bind + web mode + JWT valid → boot OK fara ack. Testul ca remote bind fara web mode pica ramane neschimbat.

Run: `npm test --workspace=backend -- index` → Expected: PASS.

- [ ] **Step 3: Configuri si docs**

Sterge linia `LEGAL_DASHBOARD_ACK_NO_AUTH` din: `deploy/docker-compose.prod.yml:94`, `docker-compose.web.example.yml:43` (+ comentariul de la ~11), `docker-build.yml` (liniile ~102 comentariu + ~114 env), `.env.example:19`, `backend/.env.example:52`. Actualizeaza referintele din README.md, SECURITY.md (inclusiv tabelul env), RUNBOOK.md (tabel), DEPLOY-SERVER.md, SESSION-HANDOFF.md (tabel kill switches): remote bind cere acum doar `LEGAL_DASHBOARD_ALLOW_REMOTE=1` + `AUTH_MODE=web` + JWT valid.

Sanity: `Grep -i "ACK_NO_AUTH" .` la final — hit-uri acceptate doar in CHANGELOG.md, `frontend/src/data/changelog-entries.tsx` (istoric), `audit/**`, `EXECUTION-ROADMAP.md`, `STATUS.md` (istoric).

- [ ] **Step 4: Commit**

```bash
git add backend/src/index.ts backend/src/index.test.ts deploy/docker-compose.prod.yml docker-compose.web.example.yml .github/workflows/docker-build.yml .env.example backend/.env.example README.md SECURITY.md RUNBOOK.md DEPLOY-SERVER.md SESSION-HANDOFF.md
git commit -m "feat(security): retire LEGAL_DASHBOARD_ACK_NO_AUTH gate — web auth requirement supersedes it"
```

### Task B2: Cookie de sesiune `sameSite: "Strict"`

**Files:**
- Modify: `backend/src/routes/auth.ts` (liniile 33, 89, comentariul 117)
- Test: `backend/src/routes/auth.test.ts:95`, `backend/src/routes/auth.oauth2.test.ts:179`
- Docs: `DEPLOY-SERVER.md:142`, `SECURITY.md:238`

- [ ] **Step 1: Testele first (red)**

Schimba expectarile: `expect(cookie.toLowerCase()).toContain("samesite=strict");` in ambele teste (+ titlul testului oauth2 "SameSite=Lax" → "SameSite=Strict").

Run: `npm test --workspace=backend -- auth` → Expected: FAIL.

- [ ] **Step 2: Implementare**

`auth.ts:33` si `auth.ts:89`: `sameSite: "Strict"`. Comentariul de la ~117: `SameSite=Lax` → `SameSite=Strict` si adauga o linie:
```
//    SameSite=Strict e sigur aici: cookie-ul e consumat doar de fetch-uri
//    same-origin din SPA; sync-ul oauth2-proxy e server-to-server (header-e),
//    iar linkurile din emailuri duc la portal.just.ro, nu in aplicatie.
```

- [ ] **Step 3: Run + docs + commit**

Run: `npm test --workspace=backend -- auth` → Expected: PASS.
Actualizeaza `DEPLOY-SERVER.md:142` si `SECURITY.md:238` (Lax → Strict).

```bash
git add backend/src/routes/auth.ts backend/src/routes/auth.test.ts backend/src/routes/auth.oauth2.test.ts DEPLOY-SERVER.md SECURITY.md
git commit -m "feat(security): session cookie sameSite Strict"
```

---

## Workstream C — JWT revocation (JTI denylist)

### Task C1: Migratia 0038 + repository denylist

**Files:**
- Create: `backend/src/db/migrations/0038_jwt_denylist.up.sql`
- Create: `backend/src/db/migrations/0038_jwt_denylist.down.sql`
- Create: `backend/src/db/jwtDenylistRepository.ts`
- Create: `backend/src/db/jwtDenylistRepository.test.ts`

- [ ] **Step 1: Migratia**

`0038_jwt_denylist.up.sql`:
```sql
-- v2.38.0: logout-ul invalideaza tokenul server-side (web mode). Tokenele au
-- claim jti; la logout jti-ul intra aici si authProvider il refuza. Randurile
-- expira natural (purge zilnic pe expires_at, aliniat cu retention-ul existent).
CREATE TABLE jwt_denylist (
  jti TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT 'local',
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER NOT NULL
);
CREATE INDEX idx_jwt_denylist_expires_at ON jwt_denylist(expires_at);
```
`0038_jwt_denylist.down.sql` (conventie repo: include delete din `_schema_versions`):
```sql
DROP INDEX IF EXISTS idx_jwt_denylist_expires_at;
DROP TABLE IF EXISTS jwt_denylist;
DELETE FROM _schema_versions WHERE version = 38;
```

- [ ] **Step 2: Test failing repository**

`jwtDenylistRepository.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { isJtiRevoked, purgeExpiredJti, revokeJti } from "./jwtDenylistRepository.ts";
// setup DB in-memory identic cu ownerAiSettingsRepository.test.ts (copiaza beforeEach-ul de acolo)

describe("jwtDenylistRepository", () => {
  it("revoke + lookup + idempotent conflict", () => {
    expect(isJtiRevoked("abc")).toBe(false);
    revokeJti("abc", 9999999999, "local");
    revokeJti("abc", 9999999999, "local"); // ON CONFLICT DO NOTHING
    expect(isJtiRevoked("abc")).toBe(true);
  });
  it("purge sterge doar intrarile expirate", () => {
    revokeJti("expired", 1000, "local");
    revokeJti("alive", 9999999999, "local");
    expect(purgeExpiredJti(2000)).toBe(1);
    expect(isJtiRevoked("expired")).toBe(false);
    expect(isJtiRevoked("alive")).toBe(true);
  });
});
```

Run: `npm test --workspace=backend -- jwtDenylist` → Expected: FAIL (modul inexistent).

- [ ] **Step 3: Implementare repository**

`jwtDenylistRepository.ts`:
```ts
import { getDb } from "./schema.ts";
import { assertOwnerIdForMutation } from "../util/ownerGuard.ts";

export function revokeJti(jti: string, expiresAtSec: number, ownerId: string): void {
  assertOwnerIdForMutation(ownerId, "revokeJti");
  getDb()
    .prepare(
      `INSERT INTO jwt_denylist (jti, owner_id, expires_at, revoked_at)
       VALUES (?, ?, ?, unixepoch())
       ON CONFLICT(jti) DO NOTHING`
    )
    .run(jti, ownerId, expiresAtSec);
}

export function isJtiRevoked(jti: string): boolean {
  return getDb().prepare(`SELECT 1 FROM jwt_denylist WHERE jti = ?`).get(jti) !== undefined;
}

export function purgeExpiredJti(nowSec: number = Math.floor(Date.now() / 1000)): number {
  return getDb().prepare(`DELETE FROM jwt_denylist WHERE expires_at < ?`).run(nowSec).changes;
}
```

Run: `npm test --workspace=backend -- jwtDenylist` → Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/migrations/0038_jwt_denylist.* backend/src/db/jwtDenylistRepository.ts backend/src/db/jwtDenylistRepository.test.ts
git commit -m "feat(db): migration 0038 — jwt_denylist table + repository"
```

### Task C2: jti in token, check la verify, revoke la logout, purge zilnic

**Files:**
- Modify: `backend/src/auth/jwt.ts` (interfata `AuthJwtPayload`)
- Modify: `backend/src/routes/auth.ts` (mint sites + logout)
- Modify: `backend/src/auth/authProvider.ts` (dupa verify, ~linia 79)
- Modify: `backend/src/services/monitoring/scheduler.ts` (blocul de purge zilnic, ~liniile 359-410)
- Test: `backend/src/routes/auth.oauth2.test.ts`, `backend/src/services/monitoring/scheduler.test.ts`

- [ ] **Step 1: Test failing (logout revoca tokenul)**

In `auth.oauth2.test.ts` adauga:
```ts
it("logout invalideaza tokenul server-side — refolosirea cookie-ului da 401", async () => {
  // 1. sync valid → extrage cookie-ul de sesiune (pattern existent in acest fisier)
  // 2. GET pe o ruta autentificata cu cookie → 200
  // 3. POST /api/v1/auth/logout cu acelasi cookie → 200
  // 4. repeta GET-ul de la pasul 2 cu cookie-ul vechi → expect 401
});
```
(implementeaza concret refolosind helper-ele de request din testele de sync existente in fisier).

Run: `npm test --workspace=backend -- auth.oauth2` → Expected: FAIL la pasul 4 (200 in loc de 401).

- [ ] **Step 2: `jwt.ts`**

In `AuthJwtPayload` adauga `jti?: string;` (dupa `sub`).

- [ ] **Step 3: Mint sites**

`Grep "signAuthToken(" backend/src -n` — fiecare loc care construieste payload-ul (oauth2/sync si refresh in `routes/auth.ts`) adauga:
```ts
import { randomUUID } from "node:crypto";
// ...
jti: randomUUID(),
```

- [ ] **Step 4: `authProvider.ts` — check la verify**

Dupa blocul try/catch de verify (linia ~79), inainte de `getUserById`:
```ts
if (payload.jti && isJtiRevoked(payload.jti)) {
  console.warn(`[auth.jwt_revoked] sub=${payload.sub}`);
  throw new AuthenticationError(401, "unauthorized", "Token de autentificare invalid.");
}
```
cu importul `import { isJtiRevoked } from "../db/jwtDenylistRepository.ts";`

- [ ] **Step 5: Logout revoca — inclusiv pe Bearer (Codex finding #4)**

Gap descoperit la review: logout-ul curent citeste DOAR cookie-ul (`getCookie(c, AUTH_COOKIE_NAME)`), dar `authProvider.ts:39-40` autentifica cu prioritate Bearer → cookie. Un client Bearer ar putea da logout fara sa-si revoce tokenul activ. Fix:
1. Exporta `readRequestToken` din `authProvider.ts` (acum e module-private).
2. In logout (`routes/auth.ts:51`): `const rawToken = readRequestToken(c);` in loc de `getCookie(...)`.
3. Insertia `revokeJti` ramane INAUNTRUL blocului `if (rawToken) { try { ... } }` existent, unde `payload` si `user` sunt in scope (atentie: `payload` e block-scoped acolo — nu muta apelul in afara blocului):
```ts
if (user && user.status === "active") {
  auditOwnerId = user.id;
  auditActorId = user.id;
  tokenVerified = true;
  if (payload.jti && typeof payload.exp === "number") {
    revokeJti(payload.jti, payload.exp, user.id);
  }
}
```
4. Test suplimentar: logout cu token DOAR in header `Authorization: Bearer ...` (fara cookie) → refolosirea aceluiasi Bearer pe o ruta autentificata da 401.

- [ ] **Step 6: Purge zilnic in scheduler**

In `scheduler.ts`, in `scheduleRunPurge()` dupa blocul `purgeOldAiUsage` (~linia 410), al treilea try/catch independent (acelasi pattern):
```ts
try {
  const deletedJti = purgeExpiredJti(Math.floor(this.opts.clock.now().getTime() / 1000));
  if (deletedJti > 0) {
    console.log(
      JSON.stringify({
        action: "jwt_denylist.purged",
        deleted_count: deletedJti,
        ts: this.opts.clock.now().toISOString(),
      })
    );
  }
} catch (err) {
  console.error("[scheduler] purgeExpiredJti threw, continuing loop", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
}
```
In `scheduler.test.ts`, in describe-ul "daily monitoring_runs retention purge", adauga un test ca timer-ul zilnic sterge intrarile jwt_denylist expirate (seed cu `revokeJti("x", 1, "local")`, avanseaza clock-ul, assert `isJtiRevoked("x") === false`).

- [ ] **Step 7: Run + commit**

Run: `npm test --workspace=backend -- auth scheduler jwtDenylist` → Expected: PASS (inclusiv testul din Step 1).

```bash
git add backend/src/auth/jwt.ts backend/src/auth/authProvider.ts backend/src/routes/auth.ts backend/src/services/monitoring/scheduler.ts backend/src/routes/auth.oauth2.test.ts backend/src/services/monitoring/scheduler.test.ts
git commit -m "feat(auth): JWT revocation — jti claim, denylist check on verify, revoke on logout, daily purge"
```

---

## Workstream F — Reziduale confirmate din audit-uri (mici)

Sursa: `audit/DEEP-REVIEW-ARCHITECTURE-CODE-BUGS-SECURITY-2026-05-22.md`, `audit/DEEP-AUDIT-MULTI-FIELD-2026-06-02.md`, `audit/FIX-PLAN-CLUSTER-VALIDATION-IO.md`. Fiecare item de mai jos a fost RE-VERIFICAT in cod la 2026-06-12 — restul findings-urilor din acele documente sunt fie deja livrate, fie respinse/deferate explicit (vezi sectiunea "Adjudecare findings audit" de la final).

### Task F1: `streamCap.ts` — elimina fallback-ul `.text()` neplafonat

**Files:**
- Modify: `backend/src/util/streamCap.ts` (liniile 14-19)
- Test: `backend/src/util/streamCap.test.ts` (daca exista; altfel skip test nou — comportamentul e echivalent)

- [ ] **Step 1:** In Node/undici `response.body` e null doar pe raspunsuri fara continut (204/HEAD), unde `.text()` e oricum `""`. Pastram garantia de cap fara citire neplafonata:

```ts
  if (!response.body) {
    // Body null = raspuns fara continut (204/HEAD). Nu exista cale legitima
    // prin care un raspuns mare sa ajunga aici — si daca ar exista, .text()
    // l-ar citi integral in memorie INAINTE de check, anuland cap-ul.
    return "";
  }
```

- [ ] **Step 2:** Run: `npm test --workspace=backend -- streamCap` → Expected: PASS.
- [ ] **Step 3:** Commit: `fix(net): streamCap — drop unbounded .text() fallback for null-body responses`

### Task F2: CSP `connect-src` — port mort 3001

**Files:**
- Modify: `frontend/index.html:7`

- [ ] **Step 1:** `connect-src 'self' http://localhost:3001` referentiaza un port pe care nu ruleaza nimic (backend e 3002). Inlocuieste `http://localhost:3001` cu `http://localhost:3002 http://127.0.0.1:3002` (acopera dev-ul Vite 5173 → backend 3002; in productie frontend-ul e servit chiar de backend, deci `'self'` acopera).
- [ ] **Step 2:** Smoke dev: `npm run dev:backend` + `npm run dev:frontend`, verifica in consola browser ca fetch-urile spre 3002 nu sunt blocate de CSP.
- [ ] **Step 3:** Commit: `fix(csp): connect-src dead port 3001 -> 3002`

### Task F3: `lastTestSendByOwner` — prune la acces

**Files:**
- Modify: `backend/src/routes/me.ts` (~linia 272)
- Test: `backend/src/routes/me.test.ts` (sau fisierul de teste existent pentru ruta)

- [ ] **Step 1:** Map-ul creste nelimitat in web mode (un entry per owner care a dat vreodata test send). Adauga prune inline la fiecare request — fara timer, fara dependinte:

```ts
const TEST_COOLDOWN_MS = 60_000;
const lastTestSendByOwner = new Map<string, number>();

// Entry-urile mai vechi decat cooldown-ul nu mai influenteaza nicio decizie —
// le stergem la fiecare acces ca Map-ul sa nu creasca nelimitat in web mode.
function pruneExpiredTestCooldowns(now: number): void {
  for (const [owner, ts] of lastTestSendByOwner) {
    if (now - ts > TEST_COOLDOWN_MS) lastTestSendByOwner.delete(owner);
  }
}
```
si apeleaza `pruneExpiredTestCooldowns(Date.now())` la inceputul handler-ului `POST /email-settings/test`, inainte de check-ul de cooldown.

- [ ] **Step 2:** Test: dupa un test send si avans de timp peste cooldown (vitest fake timers sau injectie de timestamp), Map-ul nu mai contine owner-ul (foloseste `resetEmailTestCooldownForTests` ca baseline in setup).
- [ ] **Step 3:** Run: `npm test --workspace=backend -- me` → Expected: PASS.
- [ ] **Step 4:** Commit: `fix(me): prune expired email-test cooldown entries (unbounded map in web mode)`

### Task F4: Dependabot pentru scanare CVE

**Files:**
- Create: `.github/dependabot.yml`

- [ ] **Step 1:** Nu exista nicio scanare automata de vulnerabilitati pe dependinte (finding S2, ambele audituri). Creeaza:

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
    groups:
      npm-minor-patch:
        update-types: ["minor", "patch"]
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

Nota: workspace-urile `backend/` si `frontend/` sunt acoperite de lockfile-ul root (npm workspaces — un singur `package-lock.json`), deci o singura intrare npm e suficienta. Gruparea minor+patch limiteaza zgomotul de PR-uri.

- [ ] **Step 2:** Commit: `ci: add dependabot config (weekly npm + actions, grouped minor/patch)`

---

## Workstream E — Release v2.38.0

### Task E1: Version bump + changelog + docs

Urmeaza `## Checklist bump de versiune` din CLAUDE.md, in ordine:

- [ ] **Step 1 (mereu):** `package.json` (root + backend + frontend) + `package-lock.json` → `2.38.0`; `frontend/src/data/changelog-entries.tsx` (entry nou v2.38.0 cu sectiunile: model refresh, eliminare chinese stack, ack gate retire, sameSite Strict, JWT revocation, AI hardening); `CHANGELOG.md` (sectiune noua, single source of truth); `README.md` (versiune + brief); `SESSION-HANDOFF.md` (context + tabel kill switches FARA ack); `STATUS.md` (header); `DOCUMENTATIE.md` (camp versiune).
- [ ] **Step 2 (conditional, releaseul atinge security):** `SECURITY.md` — actualizeaza sectiunile ack/cookie/JWT + entry in changelog table de la baza. `HARDENING.md` — marcheaza findings inchise (sameSite, ack, revocation) daca figureaza in backlog.
- [ ] **Step 3 (sanity):** `Grep -i "2\.37\.1" *.md` — fiecare hit non-istoric se actualizeaza. `Grep -i "opus 4.6\|chinezesc\|chinese" README.md SECURITY.md DOCUMENTATIE.md SESSION-HANDOFF.md` — zero hit-uri active. `deploy/docker-compose.prod.yml:81` — `APP_VERSION:-2.38.0`.
- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(release): v2.38.0 — model refresh (Opus 4.8, Gemini 3.5 Flash), chinese stack removal, security hardening"
```

### Task E2: Verificare finala pre-push (non-negotiable)

- [ ] **Step 1:** `npx biome check --write .` → re-stage daca reformateaza.
- [ ] **Step 2:** `npx tsc --noEmit -p backend/tsconfig.json` si `cd frontend && npx tsc --noEmit` → zero erori.
- [ ] **Step 3:** `npm run build` → bundle curat.
- [ ] **Step 4:** `npm test --workspace=backend` + `cd frontend && npm test -- --run` → PASS integral.
- [ ] **Step 5:** Smoke desktop: `npm run build` + relaunch Electron (memorie: `electron:dev` NU reconstruieste bundle-ul; verifica preventiv ABI better-sqlite3 cu `npx prebuild-install --runtime=electron --target=41.5.0` in `node_modules/better-sqlite3` daca a rulat `npm test` inainte). Verifica: dropdown modele fara chineze, label Opus 4.8 / 3.5 Flash, disclaimer sub analiza AI, toggle OpenRouter fara Vestic/Chinezesc.
- [ ] **Step 6:** Daca biome a reformatat dupa commit-ul de release: commit follow-up `style: biome format pass`.
- [ ] **Step 7:** Push + PR spre `main` (titlu: `feat: v2.38.0 — security hardening + model refresh + chinese stack removal`).

---

## Impact asupra functionalitatii (rezumat pentru review)

| Schimbare | Desktop | Web |
|-----------|---------|-----|
| Chinese stack eliminat | Userii care foloseau GLM/Kimi/Qwen pierd modelele; setarea lor revine pe western la migrare. Istoricul de cost ramane intact. | Identic |
| Opus 4.6 → 4.8 | Acelasi pret (5/25 OpenRouter; nativ se IEFTINESTE — 15/75 era gresit). Tokenizer nou poate creste consumul de tokens cu pana la 35% la acelasi text. | Identic |
| Gemini 3 Flash → 3.5 Flash | Pret mai mare (0.3/2.5 → 1.5/9) dar model superior; ramane tier-ul "Echilibrat". | Identic |
| Ack gate eliminat | Zero impact (desktop e loopback). | Operatorul nu mai seteaza un env redundant; protectia reala (web auth obligatoriu la remote bind) ramane fatala la boot. |
| sameSite Strict | Zero impact (desktop e same-origin). | Zero flow rupt: SPA fetch-uri same-origin; oauth2-proxy sync e server-to-server; emailurile linkeaza portal.just.ro. |
| JWT revocation | Zero impact (DesktopAuthProvider nu emite tokene). | Logout invalideaza efectiv sesiunea; +1 SELECT indexat per request autentificat. |
| Cap sedinte/parti 500 | Dosare reale nu ating 500; doar payloaduri abuzive sunt respinse. | Identic |
| Timeout analyze-multi 1020s → 420s | Analizele western se incadrau oricum sub 360s. | Identic |

## Riscuri si mitigari

1. **Tokenizer Opus 4.7+** consuma pana la 35% mai multe tokens — costul per analiza creste putin desi pretul unitar e neschimbat; AI_MAX_TOKENS 8000 ramane suficient pentru output (a fost suficient si pentru 4.6 western).
2. **Useri cu selectie chineza activa in UI** in momentul update-ului: `validateAiBody` respinge cheile necunoscute cu "Model necunoscut" — Step A5.5 acopera coercion-ul la default.
3. **Migratiile 0036-0038** sunt aditive/data-fix; backup-ul pre-migration generic exista deja (CLAUDE.md). Rollback: down-urile 0037 (drop coloane) si 0038 (drop tabela) functionale, 0036 no-op pe date asumat; toate down-urile sterg versiunea din `_schema_versions` (conventie repo).
4. **Tokene emise inainte de v2.38.0** nu au `jti` — nu pot fi revocate individual; expira in max TTL (default 1h). Acceptat.

## Adjudecare findings audit (2026-05-22 + 2026-06-02 + FIX-PLAN clusters)

Verificare facuta la 2026-06-12 vs codul v2.37.1. Statusuri: INCLUS (intra in v2.38.0), DEJA LIVRAT (audit-ul e stale), DEFERAT (real dar nu in scope-ul acestui release), RESPINS (nu e real / risc acceptat documentat).

**INCLUS in v2.38.0 (Workstream F):** streamCap fallback neplafonat (F1), CSP port mort 3001 (F2), `lastTestSendByOwner` unbounded (F3), Dependabot absent (F4).

**DEJA LIVRATE — nu mai exista (rapoartele de audit sunt stale pe ele):**
- RNPM boot warning + audit la `RNPM_RUNTIME_VALIDATION_DISABLED=1` — livrat in `index.ts:499-516`.
- `system.boot` cu `nodeEnv` in detail — livrat in `index.ts:471`.
- ECB FX low-bound test — livrat in `fxFetcher.test.ts:137-151`.
- IPv6 trusted proxy CIDR — limitarea e documentata si semnalizata la boot (`index.ts:475-491`, warn `proxy.trusted_cidr.unsupported`).
- Toate task-urile din FIX-PLAN-CLUSTER-AUDIT-TRAIL / DEPLOYMENT-TOPOLOGY / QUOTA-BUDGET — verificate livrate (sanitize, system.boot/shutdown, instance lock, digest pinning, TOCTOU reservation, cooldown-uri, retry budget).

**DEFERATE explicit (real, dar nu in acest release):**
- SMTP retry jitter (thundering herd la 80% budget) — ~1h, relevant doar la sute de useri web simultani.
- Test defensiv Caddy strip `X-Auth-Request-*` — nice-to-have de compliance, Caddyfile-ul e corect.
- Inflight dedup per-proces (B3) — by design pana la migrarea multi-instanta (Postgres/Redis), documentat in PLAN-monitoring-webmode.
- Stale closures + memoizare filtre frontend (B2/B4-B7) — pas de calitate v2.39; rapoartele intre audituri se contrazic pe care mai sunt reale, necesita re-verificare punctuala atunci. Nota: `useAiSettings` e oricum rescris in Task A5.
- IPC timeout fara `clearTimeout` in `preload.js` — timer zombie inert de max 10s, desktop-only; nu justifica atingerea preload-ului in release-ul asta.
- Cod duplicat (streamExportResult/readLimitedJsonBody/safeJsonParse, markdown renderer) + fisiere mari (rnpm.ts 1144 LOC) — refactor v2.39+, per regula "bundle cu urmatoarea schimbare functionala in fisier".
- Code signing binaries (S1) — decizie comerciala (cert EV/OV), tracked in HARDENING.md.
- Consent/PRIVACY pentru date trimise la provideri AI (S3) — partial adresat de disclaimer-ul D3; un consent flow complet e scope separat, de discutat cu userul.

**RESPINSE (risc acceptat deja documentat in CLAUDE.md/SECURITY.md):** SOAP HTTP upstream, search history in localStorage pe desktop, `masterKeyCache` per proces, SQLite single-writer (roadmap Postgres), backend in-process cu Electron (exista event-loop watchdog).

## Review extern (Codex, 2026-06-12)

Planul a fost reviewuit adversarial de Codex pe codebase-ul real. Findings incorporate: #1 `AiUsageRoutingTag` chinese (Task A4 Step 2), #4 Bearer logout fara revocare (Task C2 Step 5), #5 scoping `payload` in logout (idem), #8 numerotare migratii D4↔C1 (0037 latency / 0038 denylist), #9 conventia `DELETE FROM _schema_versions` in toate down-urile, #12-13 enumerarea completa a consumatorilor frontend (Task A5 Step 1). Arii confirmate curate de Codex: sameSite Strict (niciun flow cross-site dependent de cookie), plasarea check-ului de denylist in authProvider, eliminarea ack gate (CI/scripts fara dependinte ascunse), absenta persistentei localStorage pe chei de model.
