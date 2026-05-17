# Task pentru Codex — OpenRouter toggle (copy/paste mai jos)

Trimite catre Codex urmatorul prompt integral. Promptul presupune ca Codex are acces la repo-ul local `c:\Users\Cezar\Desktop\Claude Code\Legal Dashboard`.

---

## PROMPT — copy de aici pana la `END PROMPT`

Implementeaza OpenRouter toggle cu 2 stack-uri (vestic/chinezesc) pentru Legal Dashboard, pe branch dedicat `feat/openrouter-toggle-stacks` (NU pe main).

### Context

Repo: `c:\Users\Cezar\Desktop\Claude Code\Legal Dashboard`
Branch curent: `main` la commit `aac5235` (v2.27.5).
Aplicatia: Electron desktop + Hono backend + React frontend pentru cautare dosare juridice.

Citeste OBLIGATORIU INAINTE de orice cod, in ordine:
1. `PLAN-openrouter-toggle.md` (root repo) — planul detaliat consolidat din 5 rapoarte agenti. ACESTA ESTE SPEC-UL care trebuie urmat punctual. Toate deciziile arhitecturale (mode/stack, migrations, kill switches, UI layout) sunt inchise acolo.
2. `CLAUDE.md` — proiect rules. Citeste in special sectiunile „Workflow obligatoriu pentru push pe GitHub" si „Checklist bump de versiune".
3. Fisierele existente care vor fi extinse:
   - `backend/src/services/ai.ts`
   - `backend/src/services/aiUsage.ts`
   - `backend/src/routes/ai.ts`
   - `backend/src/db/aiUsageRepository.ts`
   - `frontend/src/components/ApiKeyDialog.tsx`
   - `frontend/src/components/dosare-ai-config.ts`
   - `frontend/src/components/dosare-ai-analysis-panel.tsx`
   - `frontend/src/hooks/useApiKey.ts`
4. `backend/src/db/migrations/runner.ts` + ultimele 2 migrations (`0021`, `0022`) ca model pentru pre-migration backup si test scaffolding.

### Decizii arhitecturale FERME (NU le redeschide, sunt aprobate de user)

- 2 nivele toggle: `Mode = native | openrouter`; daca openrouter, sub-toggle `Stack = western | chinese`.
- Persistenta in tabela noua `owner_ai_settings` (migration 0023).
- `ai_usage.provider` CHECK extins la 'openrouter' (migration 0024 cu REBUILD complet — SQLite nu permite ALTER CHECK existent).
- `OPENROUTER_DISABLED=1` env var ca kill switch operational.
- Stack mixing INTERZIS in multi-agent: 400 cu `error.code = "STACK_MIX_FORBIDDEN"`.
- Web mode: doar env `OPENROUTER_API_KEY`; body keys refuzate ca azi via `rejectApiKeysFromBodyInWebMode`.
- Mode=native = backward-compat 100% (flow-ul existent nu se atinge cand `mode === "native"`).
- **UI ApiKeyDialog la mode=openrouter: 1 SINGUR slot vizibil „OpenRouter API Key" (sk-or-v1-…). Sloturile Anthropic/OpenAI/Google dispar (unmount, NU grayed-out).** Decizia user explicita 2026-05-16.

### Ordine de implementare (obligatorie — fa commit incremental dupa fiecare stage)

1. `git checkout -b feat/openrouter-toggle-stacks` pornind din `main` la commit `aac5235`.

2. **Stage 1 — Migrations:**
   - `backend/src/db/migrations/0023_owner_ai_settings.up.sql` + `.down.sql` + `.test.ts` (per spec §2.1, §2.2).
   - `backend/src/db/migrations/0024_ai_usage_openrouter.up.sql` + `.down.sql` + `.test.ts` (per spec §2.3, §2.4, §2.5).
   - Migration 0024 trebuie sa includa warning headers in SQL si REBUILD complet ai_usage table cu coloana noua `routing_tag TEXT` adaugata.
   - Test up/down/up roundtrip + verificare CHECK constraint pre/post.
   - Commit: `feat(db): migrations 0023+0024 pentru OpenRouter settings + ai_usage extension`

3. **Stage 2 — Repository:**
   - `backend/src/db/ownerAiSettingsRepository.ts` cu helperi `getSettings(ownerId)` + `upsertSettings(ownerId, data)`. SQL raw via `db.prepare()` (SQL raw doar in `backend/src/db/**` per CLAUDE.md).
   - Teste unitare pentru repository (read default, upsert, owner isolation).
   - Commit: `feat(db): owner_ai_settings repository cu owner isolation`

4. **Stage 3 — Backend services:**
   - In `aiUsage.ts`: extinde `AiUsageProvider` cu `"openrouter"` (per spec §4.1). Adauga `MODEL_PRICES_USD_PER_MILLION.openrouter` cu 12 entries (per spec §4.1 — copiaza valorile exacte din spec). Adauga column `routing_tag` la INSERT in `logAiCall()` cu tip `routing_tag?: "native" | "openrouter:western" | "openrouter:chinese"`.
   - In `ai.ts`: adauga `OPENROUTER_WESTERN_MAP`, `OPENROUTER_CHINESE_MAP`, `resolveOpenRouterSlug()`, `callOpenRouter()` (per spec §3.1, §3.2 — copiaza implementarea exacta din spec, inclusiv `HTTP-Referer` si `X-Title` headers, `extra_body: { usage: { include: true } }` pentru cost real USD, OPENROUTER_DISABLED throw, abort propagation).
   - Modifica `callModel()` cu semnatura noua `routing?: { mode, stack }` si branch nou (per spec §3.3).
   - Extinde `AI_MODELS` cu 3 entries chinezesti + camp `stack` pe toate 12 entries (per spec §3.4).
   - Extinde `JUDGE_MODELS` cu `"qwen-3.6-max"` (per spec §3.4).
   - Commit: `feat(ai): callOpenRouter + dual-stack model map + stack-aware callModel`

5. **Stage 4 — Backend routes:**
   - In `routes/ai.ts`:
     - `GET /api/v1/ai/settings` + `PUT /api/v1/ai/settings` cu Zod validation (per spec §5.1).
     - `assertStackPurity()` apelat in `/analyze-multi` (per spec §5.2) — refuza mix western+chinese.
     - Pasare `routing = { mode, stack }` la fiecare `callModel(...)` in flow-ul SSE (per spec §5.3).
     - Extinde `rejectApiKeysFromBodyInWebMode` sa refuze si `apiKeys.openrouter` cand `AUTH_MODE=web` (per spec §5.4).
   - Teste pentru rutele noi + stack purity + web-mode gate.
   - Commit: `feat(ai): rute settings + stack-purity validation + web-mode hardening`

6. **Stage 5 — Frontend:**
   - `useApiKey` extins cu slot al 4-lea `openrouter` (encrypted via safeStorage IPC exact ca celelalte 3).
   - Hook nou `useAiSettings()` (`frontend/src/hooks/useAiSettings.ts`) — GET la mount + PUT optimistic.
   - `dosare-ai-config.ts`: adauga helper `availableModels(mode, stack)` cu mapping per spec §6.2 (9 native / 9 western mirror / 3 chinese).
   - `ApiKeyDialog.tsx`: 2 toggle-uri vizuale (Mode radio + Stack radio cand mode=openrouter). Layout reactiv:
     - mode=native → 3 sloturi (Anthropic / OpenAI / Google) ca azi.
     - mode=openrouter → 1 SINGUR slot vizibil „OpenRouter API Key (sk-or-v1-…)". Celelalte sloturi se unmount complet (nu grayed-out).
     - Comutarea intre moduri trebuie sa fie instantanee. Cheile native salvate raman in localStorage encrypted — la comutare inapoi pe native, sloturile reapar populate.
   - `dosare-ai-analysis-panel.tsx`: selector-ele de modele (single + multi-agent) folosesc `availableModels(mode, stack)`.
   - Commit: `feat(ui): ApiKeyDialog cu mode/stack toggle + model picker filtered per stack`

7. **Stage 6 — Documentatie + version bump:**
   - `.env.example` (root + backend) extins cu 3 variabile (per spec §7.3).
   - `CLAUDE.md`: adauga `OPENROUTER_DISABLED=1` in sectiunea „Comenzi" (alaturi de `MONITORING_DISABLED_KINDS`).
   - Bump versiune la **v2.28.0** urmand strict checklist-ul din CLAUDE.md sectiunea „Checklist bump de versiune":
     - `package.json` x3 (root + `backend/` + `frontend/`) + `package-lock.json`
     - `frontend/src/data/changelog-entries.tsx` — entry nou pentru v2.28.0 (OpenRouter integration)
     - `CHANGELOG.md` — sectiune noua v2.28.0
     - `README.md` — campul „Versiune curenta"
     - `SESSION-HANDOFF.md` — context update
     - `STATUS.md` — header update
     - `DOCUMENTATIE.md` — campul „Versiune curenta"
   - Sanity check: `Grep -i "v2.27.5"` pe toate `.md` la root, fiecare hit non-istoric inlocuit.
   - Commit: `release: v2.28.0 — OpenRouter toggle cu 2 stack-uri`

### Pre-push gates (toate obligatoriu verzi, in ordine, per CLAUDE.md)

1. `npx biome check --write .` (apoi re-stage fisierele modificate de biome).
2. `npx tsc --noEmit -p backend/tsconfig.json`
3. `cd frontend && npx tsc --noEmit`
4. `npm run build` (vite + esbuild backend CJS)
5. `npm test --workspace=backend`
6. `cd frontend && npm test -- --run`

Niciunul nu poate da fail. Niciun `--no-verify`. Daca biome reformateaza dupa commit-urile de stage-uri, fa commit follow-up `style: biome format pass` si include-l inainte de push.

### Push + PR

```
git push -u origin feat/openrouter-toggle-stacks
gh pr create --title "feat(ai): OpenRouter toggle cu 2 stack-uri (vestic/chinezesc)" --body "$(cat <<'EOF'
## Summary
- Toggle 2-level (mode native|openrouter + stack western|chinese) pentru AI providers
- Migration 0023 (owner_ai_settings) + 0024 (ai_usage CHECK widening)
- Mode=openrouter colapseaza UI la 1 slot vizibil (sk-or-v1-...)
- Stack mixing interzis in multi-agent (400 STACK_MIX_FORBIDDEN)
- Kill switch OPENROUTER_DISABLED=1
- Web mode: doar env OPENROUTER_API_KEY

## Spec
Vezi `PLAN-openrouter-toggle.md` (11 sectiuni, ~40 teste mapate, 4 BLOCKERS rezolvati inline).

## Test plan
- [ ] Migration 0024 up/down/up roundtrip (CI)
- [ ] Backend tests verzi (vitest)
- [ ] Frontend tests verzi (vitest)
- [ ] tsc backend + frontend verzi
- [ ] biome check verde
- [ ] Smoke desktop manual: comutare native ↔ openrouter:western ↔ openrouter:chinese in ApiKeyDialog, analiza single + multi-agent pe fiecare stack

## BLOCKERS rezolvati
1. ai_usage.provider CHECK extins
2. MODEL_PRICES_USD_PER_MILLION.openrouter cu 12 entries
3. Web-mode key storage: env-only definit
4. OPENROUTER_DISABLED=1 kill switch implementat

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Constrangeri stricte

- NU touch-uia main. NU push pe main. NU rebase pe main.
- NU folosi `--no-verify` la commit. NU folosi `-c commit.gpgsign=false`.
- NU implementa auto-fallback la native cand OpenRouter esueaza (silent billing redirect = trust issue).
- NU adauga emoji in cod sau comentarii (doar in PR body / commit messages e OK conform conventiei).
- NU adauga JSDoc/comentarii „what does this do" — doar „why" cand non-evident.
- `owner_id` pe orice rand nou — DEFAULT `'local'` in DDL.
- SQL raw doar in `backend/src/db/**`. Service/route layer foloseste repository functions.
- Limba mesajelor UI: romana fara diacritice. Comentariile in cod pot fi engleza sau romana.

### Daca te blochezi

Daca un test esueaza din motive ne-evidente, sau o decizie din PLAN se dovedeste imposibil de respectat literal, opreste-te si raporteaza inapoi cu detalii — NU comenta testul, NU sari pre-push gates, NU modifica deciziile arhitecturale din PLAN fara escalation.

### Final deliverable

URL-ul PR-ului + un scurt rezumat (max 200 cuvinte) cu:
- Ce ai facut (3-5 bullet points)
- Fisiere atinse (count, ex. „14 fisiere atinse")
- Teste adaugate (count, ex. „37 teste noi")
- Orice avertisment pentru smoke desktop (ex. „necesita restart Electron ca __APP_VERSION__ sa reinjecteze")

## END PROMPT

---

## Indicatii suplimentare pentru tine (user)

Dupa ce Codex livreaza PR-ul:

1. Verifica statusul: `gh pr list --state open --head feat/openrouter-toggle-stacks`.
2. Citeste PR-ul si commits incremental — Codex face stage commits, deci diff-ul per commit e usor de revizuit.
3. Smoke desktop manual obligatoriu inainte de merge:
   - Restart Electron (pentru `__APP_VERSION__` reinjectare in sidebar/Dashboard).
   - Deschide `ApiKeyDialog`: testeaza comutarea native ↔ openrouter:western ↔ openrouter:chinese. Verifica ca sloturile se contracta corect.
   - Ruleaza o analiza single pe fiecare mode/stack.
   - Ruleaza o analiza multi-agent pe fiecare mode/stack. Incearca un mix interzis (analist1 vestic + analist2 chinezesc) — trebuie sa primesti 400 STACK_MIX_FORBIDDEN.
   - Verifica `ai_usage` table dupa cateva calluri: `SELECT provider, routing_tag, cost_usd_milli FROM ai_usage ORDER BY id DESC LIMIT 10;`.
4. Daca smoke trece, merge in main + tag `v2.28.0`. Daca smoke pica, dischide thread cu Codex pentru fix.

Estimat: ~8h Codex work + ~1h smoke desktop = ~9h total pana la v2.28.0 live.
