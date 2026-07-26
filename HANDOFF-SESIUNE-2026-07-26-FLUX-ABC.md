# Handoff — sesiunea 2026-07-26 (fluxurile A, B, C + doua runde de review adversarial)

**Data:** 2026-07-26
**Branch:** `feat/v2.43.0-rnpm-split` (NU `main` — `main` e urmarit de Dokploy)
**Stare:** 33 commits LOCALE, nimic pushuit. Gate complet verde. Versiunea din `package.json` e inca `2.43.2`.
**Predecesor:** [HANDOFF-SESIUNE-2026-07-26.md](HANDOFF-SESIUNE-2026-07-26.md) si
[HANDOFF-SEC-WEB-BLOCKERS-F12-2026-07-26.md](HANDOFF-SEC-WEB-BLOCKERS-F12-2026-07-26.md).

## 1. Stare la predare

| Element | Valoare |
|---------|---------|
| Commits nepushuite | 33 (`cd7b98c..4eed317`) |
| Teste backend | 2147 passed, 8 skipped (baseline sesiune: 2078) |
| Teste frontend | 401 passed (baseline sesiune: 395) |
| `npx biome check` | curat pe toate fisierele atinse |
| `tsc --noEmit` backend + frontend | curat |
| `npm run build` | curat |
| Versiune in `package.json` (x3) | `2.43.2` — **bumpul NU a fost facut** |
| Canary live AI | **NU rulat** — cere cheile userului |

Fisiere modificate necommise in worktree (`AGENTS.md`, `CLAUDE.md`, `HARDENING.md`,
`HANDOFF-SESIUNE-2026-07-26.md`, `docs/superpowers/plans/2026-07-25-opus-5-refresh.md`) sunt ale
userului (mutari in `docs/archive/`) — **nu le include in commituri**.

## 2. Ce s-a livrat

Trei fluxuri, fiecare pe acelasi tipar: plan scris pe disc -> review adversarial Codex -> integrarea
claim-urilor verificate la sursa -> implementare TDD -> review final -> fixuri.

### Flux A — securitate care blocheaza web deploy

`967c853`, `0eaf679`, `65c6eed`, `706b9ae`, `6033aed`, `bf31257`.
F12-F8 (orice user isi emitea PAT-uri), F12-F5 (cheia captcha a tenantului in raspunsul 500),
F12-F3 (limita de stocare RNPM ocolita prin `gcode` din body), CodeRabbit 1.2 (captcha consumat
inaintea gardului de restore). Plan: `docs/superpowers/plans/2026-07-26-f12-web-blockers.md`.

### Flux C — calibrare AI pentru Claude 5

`d8f8388` .. `9bed150` (11 commits). Plan:
`docs/superpowers/plans/2026-07-26-flux-c-calibrare-ai-claude5.md`.
Obiectivele declarate de user, contra carora s-a masurat fiecare decizie: **costul sa NU creasca** si
**analizele livrate sa fie corecte**.

Decizii inchise (nu le redeschide fara motiv nou):

- Plafonul de tokeni e SPLIT: `AI_MAX_TOKENS` ramane 8000 pentru modelele fara effort (GPT, Gemini,
  Haiku), `AI_MAX_TOKENS_EFFORT` = 16000 doar pentru Claude 5, care primeste si effort redus. Perechea
  e ce tine costul in frau; una fara alta ar fi fost crestere neta.
- Effort pe rol: `low` pe analisti si pe analiza single, `medium` pe judge (confirmat explicit de user).
- `extra_body` era un idiom din SDK-ul Python; pe OpenRouter `usage` si `reasoning` sunt top-level.
- Rollback-ul migratiei 0041 s-a reparat in `down.sql`, nu in `up.sql`: runnerul trateaza `.up.sql` ca
  imuabil dupa aplicare (hash in `_schema_versions`), deci editarea lui ar fi rupt boot-ul pe orice
  instalare existenta.

### Flux B — restul findings-urilor CodeRabbit

`0ae2c4e` .. `a98f9c9` (7 commits), plus corectia documentului de triaj dupa verificarea la sursa.
Plan: `docs/superpowers/plans/2026-07-26-flux-b-coderabbit.md`.

### Runda 1 de review adversarial (fable-advisor pe toate cele 21 de commits)

`481fb0c`, `5023097`, `13f6515`, `670f51a`, `7c27526`.

- **CRITICAL:** introdusesem un deadlock — `/usage` lua maintenance read si apela `measureRnpmStorage`,
  care il lua din nou; RWLock-ul e writer-preference si NEREENTRANT, deci un writer intrat la coada
  intre cele doua blocheaza permanent backup/restore/compact si admisia RNPM, cu `/health` inca verde.
  Rezolvat cu `measureRnpmStorageUnlocked`.
- Trunchierea era detectata doar pe Anthropic nativ si OpenRouter; GPT si Gemini livrau analize taiate
  ca rezultate complete.
- Analizele deja platite se aruncau cand judecatorul cadea, pe backend si inca o data pe client.
- `apiTokens.test.ts` continea un byte NUL literal, deci git il trata ca binar si testele F12-F8 nu
  apareau in niciun diff trimis la review.

### Runda 2 (fable-advisor pe remedieri, apoi advisor)

`93d57b0`, `4eed317`.

- Detectia de taiere se uita doar la plafonul de tokeni. Verificat in SDK-urile instalate:
  `openai@6.36.0` tipizeaza `incomplete_details.reason` ca `max_output_tokens | content_filter` si il
  face optional; `@google/generative-ai@0.24.1` arunca din `text()` doar pentru SAFETY / RECITATION /
  LANGUAGE, deci BLOCKLIST, PROHIBITED_CONTENT, **SPII** si OTHER returnau text partial in tacere —
  SPII fiind plauzibil tocmai pe dosare. Acum orice oprire care nu e finalizare normala e degradare, pe
  toate cele patru cai. `AiTruncatedError` expune `tokenBudget`, iar mesajul nu mai afirma bugetul de
  tokeni cand cauza e alta.
- Gate-ul de `stop_reason` pe Anthropic e verificat la sursa: uniunea din SDK e
  `end_turn | max_tokens | stop_sequence | tool_use | pause_turn | refusal`, deci excluderea celor doua
  valori de finalizare normala nu poate da fals pozitiv azi. E fail-closed deliberat.
- **Regresie proprie, prinsa de advisor:** trecerea analistilor pe `Promise.allSettled` eliminase
  taierea imediata a sibling-ului. La un `NO_API_KEY` (care respinge instant), celalalt analist genera
  pana la 180s, facturat, pe o cerere care oricum iesea pe eroare. Revenit la `Promise.all` cu abort
  imediat; analiza deja livrata se recupereaza din `done1`/`done2`, marcate in `.then`.

## 3. Ce urmeaza — in ordine

### 3.1 Bump de versiune 2.43.2 -> 2.43.3 (BLOCANT pentru push)

Comentariile din cod spun deja `v2.43.3`, dar niciun fisier din checklist nu a fost atins. Urmeaza
`## Checklist bump de versiune` din [CLAUDE.md](CLAUDE.md) — el e sursa unica pentru lista:
`package.json` x3 + lockfile, `frontend/src/data/changelog-entries.tsx`, `CHANGELOG.md`, `README.md`,
`SESSION-HANDOFF.md`, `STATUS.md`, `DOCUMENTATIE.md`.
Conditional: `SECURITY.md` **DA** (releaseul contine F12-F3, F12-F5, F12-F8) si `HARDENING.md` **DA**
(cele trei se marcheaza rezolvate in sectiunea Faza 12).
Sanity check inainte de commit: `grep -i "2.43.2"` pe toate `.md` de la radacina.

### 3.2 Canary live AI (nu se poate automatiza — cere cheile userului)

Detaliul complet e in Task 8 din planul flux C. Punctul care conteaza si care e usor de gresit:

**criteriul naiv da fals pozitiv.** `cost_usd_milli` din `ai_usage` e nenul si azi, prin fallback pe
tabelul static de preturi. Dovada ca valoarea vine de la provider e `costUsdMilli` NENUL in **linia
`ai_call` de pe stdout**, nu randul din DB.

Trei pasi: (1) un apel prin aplicatie pe `anthropic/claude-opus-5` via OpenRouter — asta e si singura
premisa a fluxului C care n-a putut fi pre-verificata (MCP-ul OpenRouter da 401), deci se face primul,
fiindca poate invalida decizia de effort pe ruta aia; (2) cate un apel nativ pe `claude-sonnet-5` si
`claude-opus-5`, sa confirme ca `output_config` e acceptat fara beta header; (3) gate complet.

### 3.3 Push pe GitLab

Userul a decis explicit: **push la final, dupa tot**. Doar pe branch, niciodata pe `main`.
Inainte de push, gate-ul obligatoriu din CLAUDE.md, in ordine: biome -> typecheck -> build -> teste.
La `git add` foloseste cai explicite — `PowerShell-7.6.4-win-x64.msi` de la radacina nu e in
`.gitignore`, deci `git add -A` l-ar include.

### 3.4 Backlog ramas (nu s-a atins in aceasta sesiune)

Cele 9 findings F12 care nu ating suprafata web raman in [HARDENING.md](HARDENING.md), sectiunea
Faza 12 — sursa unica, nu sunt duplicate aici. Raport integral:
`audit/AUDIT-CLAUDE-SECURITY-SCAN-v2.43.2-2026-07-24.md`.

## 4. Constrangeri de respectat in sesiunea urmatoare

- Branch `feat/v2.43.0-rnpm-split`. Nimic pe `main` (Dokploy deployeaza de acolo).
- Fara `git add -A` (vezi 3.3).
- Infrastructura e in afara scopului: Dokploy, `docker-compose.yml`, `deploy/`.
- Scala de severitate a proiectului: CRITICAL / HIGH / MEDIUM / LOW. Se pune si in prompturile catre
  agentii externi.
- Prioritatea proiectului e suprafata WEB, nu Electron. Smoke pe Electron doar pentru tag desktop.
- Reviewurile externe (Codex) se lanseaza cu perimetru INCHIS: lista explicita de fisiere, interdictie
  de grep pe tot repo-ul, buget de comenzi. Fara asta, doua runde au stat blocate ~48 de minute fara
  activitate in log.
