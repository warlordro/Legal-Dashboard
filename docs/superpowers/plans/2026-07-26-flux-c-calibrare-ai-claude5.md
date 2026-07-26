# Plan implementare — Flux C: calibrare AI pentru Claude 5

> **Pentru agenti:** SUB-SKILL OBLIGATORIU: `superpowers:subagent-driven-development` (recomandat) sau
> `superpowers:executing-plans` pentru executie task cu task. Pasii folosesc checkbox (`- [ ]`).

**Goal:** Adapteaza parametrii apelurilor AI la generatia Claude 5 (thinking adaptiv implicit) si repara
raportarea de cost pe ruta OpenRouter, care nu a functionat niciodata.

**Arhitectura:** Grosul schimbarilor sta in `backend/src/services/ai.ts` si `backend/src/routes/ai.ts` plus
testele lor. Ating marginal si `backend/src/services/aiUsage.ts` (un camp de tip, Task 3),
`backend/src/util/envelope.ts` (un cod de eroare, Task 6) si `SESSION-HANDOFF.md` (kill switch, Task 7). Zero suprapunere de fisiere cu Fluxul A (deja livrat) sau cu cele 8 findings CodeRabbit din
Fluxul B. Un singur release; aplicatia nu e deployata, deci nu exista baseline de date de protejat.

**Tech stack:** Node 22, `@anthropic-ai/sdk@0.94.0`, `openai@6.36.0`, `@google/generative-ai@0.24.1`, vitest, biome.

---

## Premise verificate (2026-07-26, la sursa — nu preluate din handoff)

Fiecare afirmatie de mai jos a fost verificata in aceasta sesiune. Ce n-a putut fi verificat e marcat explicit.

**1. `extra_body` nu e o functie a SDK-ului OpenAI — VERIFICAT.**
`grep -rl "extra_body" node_modules/openai/` intoarce **zero** fisiere in `openai@6.36.0`. Campul de la
`ai.ts:662-663` e un idiom din SDK-ul Python; aici pleaca literal in corpul JSON si OpenRouter il ignora.
Consecinta: `usage.cost` (`ai.ts:701`) a fost mereu `undefined`, iar `costUsdMilli` mereu `null`. Nu s-a
observat pentru ca `aiUsage.ts` cade pe tabelul static de preturi. Dublu-check operational: toate randurile
`openrouter` din `ai_usage` ar trebui sa aiba `cost` NULL.

**1b. SDK-ul openai NU filtreaza proprietatile necunoscute — VERIFICAT, si e crucial pentru Task 2.**
`node_modules/openai/internal/request-options.js:5-12`: `FallbackEncoder` face `JSON.stringify(body)` pe
obiectul INTREG, fara allowlist de chei. Doua consecinte:
(a) `usage` si `reasoning` puse top-level chiar pleaca in JSON — abordarea din Task 2 e valida, nu reproduce
bug-ul `extra_body` in alta forma;
(b) rafineaza diagnosticul: `extra_body` a fost trimis mereu, ca o cheie literala numita `extra_body`, pe care
OpenRouter n-o interpreteaza. SDK-ul nu a aruncat-o — a trimis-o fidel, la o adresa pe care serverul nu o
citeste. Rezultatul e acelasi (cost niciodata raportat), dar cauza nu e "SDK-ul filtreaza".

**2. `output_config.effort` e tipizat nativ, fara beta header — VERIFICAT.**
`node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts:708-712` declara
`OutputConfig.effort?: 'low'|'medium'|'high'|'xhigh'|'max'|null`, iar `output_config?: OutputConfig` apare pe
params la `:1912` si `:2164`. Fara cast, fara `@ts-expect-error`.

**3. Thinking-ul e pornit implicit pe Claude 5 si consuma din `max_tokens` — VERIFICAT (documentar).**
SDK-ul, in doc comment-ul de pe `thinking?: ThinkingConfigParam` (`messages.d.ts:1953-1964`): thinking
"counts towards your `max_tokens` limit". Tipul `ThinkingConfigAdaptive` (`:977-986`) exista ca varianta.
Skill-ul `~/.claude/skills/claude-api`, actualizat pe 2026-07-26 pentru familia Claude 5: cererile fara camp
`thinking` ruleaza cu thinking adaptiv, iar `max_tokens` e limita dura pe output-ul TOTAL (thinking + text),
deci raspunsul poate ieși trunchiat cu `stop_reason: "max_tokens"` dupa o faza lunga de gandire.
**Nu e verificat empiric** — nu am facut apel live. Dar e documentat din doua surse independente, deci
riscul de trunchiere e real, nu ipotetic.

**4. Effort-ul default e `high`, NU absent — VERIFICAT (documentar), si SCHIMBA framing-ul.**
Sursa: skill-ul `claude-api`, secțiunea "Thinking & Effort". A omite `output_config` echivaleaza cu `high`.
Deci trimiterea lui `medium` e o **reducere** de la maximul implicit de acum, nu o activare a unei functii
noi. Starea actuala a aplicatiei e cheltuiala maxima de thinking pe fiecare apel.

**5. Streaming la `max_tokens` mare — recomandat, dar NU rezolva timeout-ul nostru.**
Sursa documentara recomanda streaming pentru cereri cu output lung sau `max_tokens` mare.
**CORECTIE dupa review adversarial (HIGH):** streaming-ul NU elimina riscul de timeout in aplicatia asta.
`composeSignal` (`ai.ts:458-462`) construieste `AbortSignal.timeout(timeout)` — un semnal ABSOLUT, care se
declanseaza la 120s indiferent daca stream-ul primeste evenimente, iar `.finalMessage()` asteapta oricum
mesajul complet. Acelasi semnal se paseaza si la `stream`.

Ce aduce totusi streaming-ul, si de ce ramane in plan:
(a) evita guard-ul propriu al SDK-ului Anthropic pe apeluri non-streaming cu `max_tokens` mare;
(b) tine conexiunea vie, deci intermediarii (proxy, load balancer) nu o taie pe inactivitate.

Ce NU aduce: nu extinde bugetul nostru de 120s. `AI_TIMEOUT` ramane 120s, NEATINS in acest flux, si se
monitorizeaza prin `errorType: "timeout"` din `ai_call` dupa deploy. Se creste doar cu date. Riscul se
auto-atenueaza partial: `low`/`medium` reduc thinking-ul fata de `high`-ul implicit de azi, deci si durata.

**6. Allowlist-ul de modele trebuie pe sluguri EXACTE, nu pe prefix — VERIFICAT.**
`OPENROUTER_MODEL_MAP["claude-haiku"] = "anthropic/claude-haiku-4.5"` (`ai.ts:47`) si
`AI_MODELS["claude-haiku"].modelId = "claude-haiku-4-5-20251001"` (`ai.ts:18`). Un gate pe prefixul
`anthropic/` sau pe substringul `claude-` ar trimite effort catre Haiku 4.5, care nu il suporta (400 nativ,
conform skill-ului `claude-api`). Gate-ul se aplica DUPA `resolveOpenRouterSlug` (`ai.ts:76-90`), pentru ca
`OPENROUTER_MODEL_OVERRIDES` poate remapa orice cheie pe orice slug valid.

**7. Canary-ul OpenRouter NU a putut fi pre-verificat.**
MCP-ul OpenRouter din sesiune returneaza `401 User not found`, deci nu am putut confirma din timp daca
OpenRouter accepta `reasoning: { effort }` top-level pentru `anthropic/claude-opus-5` si daca
`usage: { include: true }` populeaza costul. Ramane pas de canary la implementare, cu cheia aplicatiei.

## Decizii inchise (nu le redeschide)

**Un singur release, comportament + observabilitate impreuna.** Aplicatia nu e deployata, deci argumentul
"observabilitate intai, comportament dupa" nu se aplica — nu exista date de productie de protejat.

**Prompturile system nu se ating.** `AI_ANALYSIS_SYSTEM` / `AI_JUDGE_SYSTEM` sunt curate, livrate in v2.42.0.
Lungimea outputului se masoara din `ai_usage` dupa deploy, inainte de orice revizuire de prompt.

**Effort pe rol, nu uniform** (decizie user, revizuita 2026-07-26): `low` pe cei doi analisti si pe analiza
single, `medium` pe judge. Rationament: analistii si single extrag si explica din datele dosarului — cerere de
rationament mai mica, si sunt majoritatea apelurilor, deci acolo e masa de cost. Judge-ul reconciliaza doua
analize care pot sa se contrazica: detecteaza contradictii si le cantareste, exact pasul unde thinking-ul isi
merita banii. Revert = doua string-uri.

**Risc asumat:** azi totul ruleaza pe `high` implicit, deci `low` pe analisti e o coborare de DOUA trepte
dintr-o data. Daca analizele slabesc, se vede citindu-le, nu din metrici — nu exista test automat pentru
"analiza e corecta". Nu exista masuratoare pe sarcina asta anume; e judecata pe rol.

**Nu se atinge calibrarea GPT-5.6** (Responses API `reasoning`) **si Gemini** (`thinkingConfig`) — follow-up
separat, ca delta-ul sa ramana reviewabil.

**Estimarile de cota ($0.25 single / $0.50 multi) raman** sub-dimensionate ~2x fata de noul tavan. Acceptat
constient; re-baseline din `ai_usage` dupa primele saptamani reale.

## Criteriul de succes: cost care NU creste + analize corecte

Cele doua obiective ale userului. Fiecare schimbare din plan se judeca fata de ele, nu fata de "am aplicat pasii".

| Schimbare | Direcția pe cost | Efect pe corectitudine |
|-----------|------------------|------------------------|
| `effort` pe rol: `low` analisti+single, `medium` judge (de la default `high`) | **SCADE** puternic — analistii+single sunt majoritatea apelurilor; coborare de doua trepte acolo | Risc real de scadere pe analisti; judge-ul pastreaza rationamentul unde conteaza. Semnalul de urmarit e la Task 5 |
| `usage: { include: true }` reparat | neutru | Face costul **vizibil si real**; fara el nu se poate verifica obiectivul |
| `AI_MAX_TOKENS` 8000 -> 16000 | **CREȘTE** pe apelurile care loveau plafonul (pana la 2x output facturat) | Elimina trunchierea — cauza principala de analiza incompleta |
| `TRUNCATE_ANALYSIS` ramane 50000 | **NEUTRU** — decizie user: fara crestere de input din partea noastra | Risc rezidual: o analiza peste 50k caractere ar fi taiata inainte de judge. Azi imposibil (tavan 8k tokeni ~ 35k caractere); dupa bump, rar. Se monitorizeaza prin `stopReason` |
| streaming pe `callAnthropic` | neutru | Evita guard-ul SDK pe non-streaming la tavan mare si taierile de intermediari. NU extinde bugetul de 120s — vezi premisa 5 |
| `stopReason` in log | neutru | Singurul mod de a MASURA daca trunchierea se mai intampla |

**Tensiunea, spusa explicit:** `medium` trage costul jos, tavanele il trag sus. Planul NU poate prezice
net-ul, pentru ca depinde de cat thinking cheltuie modelul la `medium` vs `high` pe dosarele reale — exact
cifra care nu exista azi, pentru ca raportarea de cost era rupta (premisa 1).

**De aceea ordinea taskurilor conteaza:** Task 2 (raportarea de cost) e livrat INAINTEA masurarii, iar Task 6
(`stopReason`) da semnalul de trunchiere. Fara ele, "costul nu a crescut" ar fi o afirmatie nesustinuta.

**Verificare post-deploy, obligatorie inainte de a declara obiectivul atins:**
compara din `ai_usage`, pe aceeasi clasa de dosare, `cost_usd_milli` mediu per `feature`
(`dosar_summary`, `dosar_multi_analyst`, `dosar_multi_judge`) inainte si dupa.

Daca media CREȘTE, levierele in jos, in ordine — **corectate dupa review adversarial (HIGH):** configuratia
de baza e DEJA `low` pe analisti + single, deci "treci analistii pe low" ar fi un no-op. Ce ramane:
(1) coboara judge-ul de la `medium` la `low` — singurul apel care mai e peste podea;
(2) coboara `AI_MAX_TOKENS` de la 16000 la 12000, daca `stopReason` arata ca trunchierea nu mai e o problema.
Ambele sunt schimbari de un string / un numar. Sub `low` nu se mai poate cobori fara a dezactiva thinking-ul,
ceea ce pe Fable 5 / Mythos 5 nici nu e permis si pe Opus 5 e o alta clasa de decizie.

Atentie: `AI_EFFORT_DISABLED` NU e levier de cost. El omite campul de effort, iar default-ul serverului e
`high` — deci activarea lui CREȘTE cheltuiala de thinking. E rollback de comportament (daca `medium`
degradeaza calitatea sau un provider respinge campul), nu de cost.

**Ce NU rezolva planul asta:** dacă `medium` degradeaza calitatea analizei, se vede doar citind analize reale,
nu din metrici. Nu exista test automat pentru "analiza e corecta". Asumat.

## Global Constraints

Branch: `feat/v2.43.0-rnpm-split`. NICIODATA push pe `main` (Dokploy deployeaza de acolo).

Fara `git add -A`. `PowerShell-7.6.4-win-x64.msi` de la radacina nu e in `.gitignore`.

Cod sursa fara diacritice. Mesaje UI in romana.

Gate inainte de FIECARE commit: `npx biome check --write <fisiere atinse>` →
`npx tsc --noEmit -p backend/tsconfig.json` → `npm run build` → `npm test --workspace=backend`.

Baseline la `6033aed` (finalul Fluxului A): **2091 teste backend trecute / 8 skipped, 395 frontend.**

Fals pozitiv cunoscut la biome: artefactul CRLF din `CLAUDE-SECURITY-20260724-195947/`, negestionat de git.

**Push:** nimic nu urca pe GitLab pana la decizia userului — se acumuleaza local cu commiturile Fluxului A.

---

## Descoperiri din mapare care schimba planul original

**A. `AI_MAX_TOKENS` nu e exportat, si un test hardcodeaza 8000.**
`ai.ts:104` e `const`, nu `export const` (spre deosebire de cele doua timeout-uri de deasupra). De aceea
`ai.openrouter.test.ts:257` asserteaza literalul `max_completion_tokens: 8000` in loc de constanta. Bump-ul
la 16000 **pica testul acela**. Fixul corect nu e sa schimbi literalul, ci sa exporti constanta si sa o
folosesti in test — altfel drift-ul se repeta la urmatorul bump.

**B. Calea de eroare din `withAiLogging` NU face spread pe meta — dar asta NU cere actiune.**
Success (`ai.ts:380-386`) face `...meta`, deci un camp nou apare automat. Eroare (`ai.ts:427-436`) e obiect
explicit, deci un camp nou NU apare acolo.

**Concluzia initiala ("adauga in ambele locuri") era GRESITA** — corectata dupa review adversarial. Nu exista
niciun producator de `stopReason` pe calea de eroare: Anthropic il livreaza pe un mesaj final REUSIT,
OpenRouter pe `choice` tot la succes, iar `withAiLogging` primeste in catch doar eroarea aruncata. `stopReason`
ramane deci DOAR pe calea de succes, unde ajunge automat prin spread. Vezi Task 6.

**C. `recordAiUsageSafely` destructureaza doar campurile cunoscute.**
`aiUsage.ts:186-200`. Un camp nou de meta ajunge in linia `ai_call` de pe stdout dar **niciodata in DB**, fara
o schimbare pereche in `insertAiUsage`. Decizie: `stopReason` ramane DOAR in log (stdout), nu in `ai_usage`.
Motiv: e semnal de diagnostic pentru saptamana de masurare, nu metrica de facturat; o coloana noua in
`ai_usage` cere migration si nu se justifica. Planul NU trebuie sa pretinda ca ajunge in DB.

**D. Calea nativa are ZERO acoperire de test pe forma requestului.**
Verificat: singurele importuri de `@anthropic-ai/sdk` si `@google/generative-ai` din `backend/src` sunt
`ai.ts:1` si `ai.ts:601`. Niciun fisier de test nu mock-uieste cele doua SDK-uri, deci `callAnthropic` si
`callGoogle` nu au nicio asertiune pe body. `max_tokens` de la `:482` si `maxOutputTokens` de la `:606` sunt
complet nefixate de teste. Consecinta pentru acest plan: allowlist-ul de effort pe ruta nativa **nu poate fi
testat fara harness nou** — un mock pe `@anthropic-ai/sdk`. Asta e infrastructura noua, nu un test in plus,
si intra in Task 3.

**E. Asimetrie de semnatura confirmata.** Ramurile native din `callModel` (`ai.ts:829-831`) paseaza SASE
argumente; `callOpenRouter` (`:824`) paseaza SAPTE (cu `routingTag`). Deci `effort` devine al 7-lea parametru
pe cele native si al 8-lea pe OpenRouter. Consecvent cu decizia "ultim parametru pozitional".

**F. Bump-ul de `AI_MAX_TOKENS` atinge TOATE cele patru rute** (constanta e partajata: `:482`, `:525`,
`:570`, `:606`, `:661`). Riscul de timeout la tavan mare se aplica deci si la GPT si Gemini, nu doar la Claude.
Decizie asumata: streaming se adauga DOAR pe `callAnthropic` (unde thinking-ul adaptiv face riscul concret si
unde oricum atingem codul). GPT si Gemini rămân non-streaming la 16k ca **rezidual acceptat**, de reevaluat in
follow-up-ul dedicat GPT-5.6/Gemini. Se noteaza in cod, nu se lasa implicit.

---

## Structura fisierelor

| Fisier | Rol | Task |
|--------|-----|------|
| `backend/src/services/ai.ts` | export `AI_MAX_TOKENS` 8000→16000 (`TRUNCATE_ANALYSIS` NEATINS), tip `AiEffort`, allowlist, `output_config` nativ, streaming Anthropic, body OpenRouter, `stopReason` pe calea de succes | 1,2,3,4,5 |
| `backend/src/services/ai.openrouter.test.ts` | literal 8000 → constanta importata; teste noi pe forma body-ului OpenRouter | 1,2 |
| `backend/src/services/ai.anthropic.test.ts` | **NOU** — harness de mock pe `@anthropic-ai/sdk`; teste pe `output_config` + streaming | 3 |
| `backend/src/routes/ai.ts` | effort pe rol: `low` pe single + cei doi analisti, `medium` pe judge; eroare pe raspuns gol (single) | 5, 6 |
| `backend/src/services/aiUsage.ts` | camp `stopReason` in `AiUsageCallMeta` (doar pentru log, NU in DB) | 3 |
| `backend/src/util/envelope.ts` | cod nou `AI_EMPTY_RESPONSE` | 6 |
| `SESSION-HANDOFF.md` | rand nou in tabelul de kill switches | 6 |

---

## Task 1: Tavanul de tokeni — export + bump

**Files:**
- Modify: `backend/src/services/ai.ts:104` (`AI_MAX_TOKENS` 8000 -> 16000). `TRUNCATE_ANALYSIS` (`:98`) NU se atinge.
- Modify: `backend/src/services/ai.openrouter.test.ts:257`

**Interfaces:**
- Produce: `export const AI_MAX_TOKENS: number` — consumat de testele din Task 2 si 3.

**De ce primul:** e schimbarea care pica un test existent. Izolata, se vede clar in review; amestecata cu
effort-ul, ar arata ca o regresie provocata de effort.

- [ ] **Step 1: Fa testul existent sa depinda de constanta, nu de literal**

In `ai.openrouter.test.ts`, adauga `AI_MAX_TOKENS` la importurile din `./ai.ts` si inlocuieste linia 257:

```ts
        max_completion_tokens: AI_MAX_TOKENS,
```

- [ ] **Step 2: Ruleaza — trebuie sa PICE la compilare/import**

```
npx vitest run backend/src/services/ai.openrouter.test.ts
```

Asteptat: eroare de import — `AI_MAX_TOKENS` nu e exportat. Asta confirma premisa A.

- [ ] **Step 3: Exporta constanta si ridica ambele plafoane**

`TRUNCATE_ANALYSIS` (`ai.ts:98`) ramane **50000** — decizie explicita a userului: fara crestere de input din
partea noastra.

**Confirmare independenta (review adversarial):** `ai.test.ts:153-161` trimite o analiza de 60.000 caractere si
asteapta trunchiere plus elipsa, cu comentariu explicit "50k is the cap". Orice ridicare peste 60000 ar fi rupt
testul asta. Decizia de a nu atinge constanta il protejeaza ca efect secundar. Justificarea tehnica sustine decizia: la tavanul actual de 8000 tokeni output-ul unui analist
e ~30-35k caractere, deci capul de 50k practic nu se atinge azi; dupa bump ar putea fi atins rar. `max_tokens`
e plafon, nu tinta — lungimea textului o dicteaza promptul, nu tavanul. Daca `stopReason` (Task 6) arata ca
taie in practica, se ridica atunci, cu date.

Modifica DOAR linia 104:

```ts
// Exportat (v2.43.3): testele asertau literalul 8000, care a driftat la primul bump.
// Constanta e PARTAJATA de toate cele patru rute (anthropic max_tokens, openai
// max_output_tokens / max_completion_tokens, gemini maxOutputTokens, openrouter
// max_tokens), deci bump-ul e tavan pentru toate — nu cost garantat.
// 16000: pe Claude 5 thinking-ul e pornit implicit si consuma din ACELASI buget ca
// textul de raspuns, deci un tavan calibrat pentru modele fara thinking taie analiza
// (stop_reason: "max_tokens") dupa o faza lunga de gandire.
export const AI_MAX_TOKENS = 16000;
```

- [ ] **Step 4: Ruleaza si confirma verde**

```
npx vitest run backend/src/services/ai.openrouter.test.ts backend/src/services/ai.test.ts backend/src/services/aiUsage.test.ts
```

- [ ] **Step 5: Gate + commit**

```bash
npx biome check --write backend/src/services/ai.ts backend/src/services/ai.openrouter.test.ts
npx tsc --noEmit -p backend/tsconfig.json
npm run build
npm test --workspace=backend
git add backend/src/services/ai.ts backend/src/services/ai.openrouter.test.ts
git commit -m "refactor(ai): exporta AI_MAX_TOKENS si ridica tavanul la 16000 (Claude 5 thinking)"
# TRUNCATE_ANALYSIS ramane 50000 — vezi nota din Step 3.
```

---

## Task 2: Body-ul OpenRouter — sterge `extra_body`, trimite camp top-level

**Files:**
- Modify: `backend/src/services/ai.ts:656-666` (obiectul trimis la `chat.completions.create`)
- Modify: `backend/src/services/ai.ts:629-637` (semnatura `callOpenRouter`, `effort` al 8-lea parametru)
- Test: `backend/src/services/ai.openrouter.test.ts` (3 teste noi)

**Interfaces:**
- Produce: `export type AiEffort = "low" | "medium" | "high";` — consumat de Task 3, 4 si 5.
- Produce: `callOpenRouter(apiKey, slug, prompt, timeout, tracking?, signal?, routingTag?, effort?)`.

**Problema:** `extra_body` e idiom Python (premisa 1). OpenRouter primeste un camp necunoscut si il ignora,
deci `usage.cost` nu vine si `costUsdMilli` e mereu null. Corect: `usage` si `reasoning` sunt proprietati
TOP-LEVEL in corpul cererii OpenRouter.

**Capcana de tipizare:** un `@ts-expect-error` pe spread conditionat pica build-ul strict ca "unused" cand
conditia e falsa. Se construieste O SINGURA variabila de body cu cast tipizat, nu spread-uri decorate.

- [ ] **Step 1: Scrie testele care pica**

In `ai.openrouter.test.ts`, helper-ul real e `mockOpenRouterResponse(options?)` (`:88-97`) si NU intoarce un
obiect — configureaza `openRouterCreateMock` intern prin `mockResolvedValue`. Deci apeleaza-l fara sa-i
folosesti valoarea de retur. Adauga:

```ts
  it("F-C: body-ul OpenRouter are usage.include top-level si NU extra_body", async () => {
    mockOpenRouterResponse({ text: "ok" });
    await callOpenRouter("k".repeat(20), "anthropic/claude-opus-5", "prompt", 5000);

    const body = openRouterCreateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(body).not.toHaveProperty("extra_body");
    expect(body.usage).toEqual({ include: true });
    expect(body.max_tokens).toBe(AI_MAX_TOKENS);
  });

  it("F-C: effort ajunge in reasoning.effort pentru un slug din allowlist", async () => {
    mockOpenRouterResponse({ text: "ok" });
    await callOpenRouter(
      "k".repeat(20), "anthropic/claude-opus-5", "prompt", 5000, undefined, undefined, undefined, "medium"
    );

    const body = openRouterCreateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(body.reasoning).toEqual({ effort: "medium" });
  });

  it("F-C: AI_EFFORT_DISABLED=1 omite reasoning si pe ruta OpenRouter", async () => {
    process.env.AI_EFFORT_DISABLED = "1";
    try {
      mockOpenRouterResponse({ text: "ok" });
      await callOpenRouter(
        "k".repeat(20), "anthropic/claude-opus-5", "prompt", 5000, undefined, undefined, undefined, "medium"
      );
      const body = openRouterCreateMock.mock.calls[0][0] as Record<string, unknown>;
      expect(body).not.toHaveProperty("reasoning");
      // usage ramane — kill switch-ul e doar pentru effort, nu pentru raportarea de cost.
      expect(body.usage).toEqual({ include: true });
    } finally {
      // biome-ignore lint/performance/noDelete: env trebuie unset real
      delete process.env.AI_EFFORT_DISABLED;
    }
  });

  it("F-C: modelele in afara allowlist-ului NU primesc reasoning", async () => {
    for (const slug of ["anthropic/claude-haiku-4.5", "openai/gpt-5.6-sol", "google/gemini-3.1-pro-preview"]) {
      openRouterCreateMock.mockClear();
      mockOpenRouterResponse({ text: "ok" });
      await callOpenRouter("k".repeat(20), slug, "prompt", 5000, undefined, undefined, undefined, "medium");
      const body = openRouterCreateMock.mock.calls[0][0] as Record<string, unknown>;
      expect(body).not.toHaveProperty("reasoning");
    }
  });
```

- [ ] **Step 2: Ruleaza si confirma ca pica**

Run: `npx vitest run backend/src/services/ai.openrouter.test.ts -t "F-C"`
Asteptat: primul pica pe `extra_body` prezent si `usage` absent; celelalte doua pe `reasoning` absent.

- [ ] **Step 3: Tipul de effort si allowlist-urile**

In `ai.ts`, imediat dupa `AI_MAX_TOKENS`:

```ts
// v2.43.3 (Claude 5): effort controleaza adancimea de thinking. Default-ul serverului
// e "high" (a omite campul == high), deci "medium" e o REDUCERE de la cheltuiala
// maxima de acum, nu o functie noua.
export type AiEffort = "low" | "medium" | "high";

// Allowlist pe valori EXACTE, nu pe prefix. `anthropic/claude-haiku-4.5` exista in
// OPENROUTER_MODEL_MAP si NU suporta effort (400) — un gate pe prefixul "anthropic/"
// sau pe substringul "claude-" l-ar include. Gate-ul OpenRouter se aplica pe slug-ul
// REZOLVAT, dupa resolveOpenRouterSlug, pentru ca OPENROUTER_MODEL_OVERRIDES poate
// remapa orice cheie pe orice slug valid.
const EFFORT_CAPABLE_MODEL_IDS = new Set(["claude-sonnet-5", "claude-opus-5"]);
const EFFORT_CAPABLE_OPENROUTER_SLUGS = new Set(["anthropic/claude-sonnet-5", "anthropic/claude-opus-5"]);

// Kill switch operational: omite campurile de effort pe AMBELE rute fara rebuild.
function effortDisabled(): boolean {
  return process.env.AI_EFFORT_DISABLED === "1";
}
```

- [ ] **Step 4: Rescrie body-ul OpenRouter**

Inlocuieste `ai.ts:656-666` cu:

```ts
      // v2.43.3: `usage` si `reasoning` sunt proprietati TOP-LEVEL in corpul cererii
      // OpenRouter. Inainte se trimitea `extra_body: { usage: { include: true } }` —
      // idiom din SDK-ul Python, inexistent in openai@6.x (zero aparitii in pachet),
      // deci pleca literal in JSON si OpenRouter il ignora: usage.cost nu venea
      // niciodata si costul cadea mereu pe tabelul static de preturi.
      // O SINGURA variabila de body cu cast: un @ts-expect-error pe spread conditionat
      // pica build-ul strict ca "unused" cand conditia e falsa.
      const sendEffort = effort !== undefined && !effortDisabled() && EFFORT_CAPABLE_OPENROUTER_SLUGS.has(slug);
      const body = {
        model: slug,
        // v2.42.0 (5.6): mesaj system separat (toChatMessages).
        messages: toChatMessages(system, user),
        max_tokens: AI_MAX_TOKENS,
        usage: { include: true },
        ...(sendEffort ? { reasoning: { effort } } : {}),
      } as unknown as Parameters<typeof client.chat.completions.create>[0];
      const completion = await client.chat.completions.create(body, {
        signal: composeSignal(timeout, signal),
      });
```

Semnatura devine, cu `effort` ULTIM:

```ts
export async function callOpenRouter(
  apiKey: string,
  slug: string,
  prompt: PromptInput,
  timeout: number,
  tracking?: AiUsageTrackingContext,
  signal?: AbortSignal,
  routingTag?: AiUsageRoutingTag,
  effort?: AiEffort
): Promise<string> {
```

- [ ] **Step 5: Ruleaza si confirma verde**

Run: `npx vitest run backend/src/services/ai.openrouter.test.ts backend/src/services/aiUsage.test.ts`

Testele de cost existente (in jur de `:199-238`) trebuie sa treaca NESCHIMBATE — citesc DB-ul, iar fallback-ul
pe tabelul static ramane valid cand providerul nu trimite cost.

- [ ] **Step 6: Gate + commit**

```bash
npx biome check --write backend/src/services/ai.ts backend/src/services/ai.openrouter.test.ts
npx tsc --noEmit -p backend/tsconfig.json
npm run build
npm test --workspace=backend
git add backend/src/services/ai.ts backend/src/services/ai.openrouter.test.ts
git commit -m "fix(ai): usage si reasoning top-level in body-ul OpenRouter, sterge extra_body"
```

---

## Task 3: Effort nativ pe Anthropic + streaming + harness de test nou

**Files:**
- Modify: `backend/src/services/ai.ts:465-500` (`callAnthropic`)
- Create: `backend/src/services/ai.anthropic.test.ts`

**Interfaces:**
- Consuma: `AiEffort`, `EFFORT_CAPABLE_MODEL_IDS`, `effortDisabled()` din Task 2.
- Produce: `callAnthropic(apiKey, modelId, prompt, timeout?, tracking?, signal?, effort?)`.

**De ce e cel mai mare task:** ruta nativa nu are NICIUN test pe forma requestului (descoperirea D), deci
harness-ul de mock pe `@anthropic-ai/sdk` e infrastructura noua. Fara el, allowlist-ul nativ ar fi complet
netestat — exact clasa de bug pe care fixul o previne.

**Streaming:** se trece pe `client.messages.stream(...).finalMessage()` — schimbare LOCALA, fara SSE spre
client, aceeasi valoare de retur. Motivul e guard-ul SDK-ului pe non-streaming la `max_tokens` mare plus
mentinerea conexiunii, NU ocolirea timeout-ului: semnalul nostru e absolut si taie la 120s oricum (premisa 5).
Nu scrie in cod sau in commit ca streaming-ul rezolva timeout-urile.

**Ordine — CORECTAT dupa review adversarial (HIGH):** campul `stopReason` din `AiUsageCallMeta` se adauga
**in acest task**, nu in Task 6, si `aiUsage.ts` intra in commitul de aici. Varianta initiala (adauga tipul in
Task 6, foloseste-l in Task 3) producea un commit care trece gate-ul pe working tree dar NU compileaza ca
snapshot izolat — deci un `git revert` sau un bisect ar da o stare rupta.

- [ ] **Step 0: Adauga campul de tip, ca acest commit sa compileze singur**

In `backend/src/services/aiUsage.ts`, in `AiUsageCallMeta` (`:16-24`):

```ts
  // v2.43.3: DOAR pentru linia de log `ai_call` (semnal de trunchiere pe Claude 5).
  // NU se persista in `ai_usage`: recordAiUsageSafely (`:186-200`) destructureaza doar
  // campurile cunoscute, iar o coloana noua ar cere migration pentru un semnal de
  // diagnostic, nu o metrica de facturat.
  stopReason?: string;
```

- [ ] **Step 1: Creeaza harness-ul si testele care pica**

Fisier nou `backend/src/services/ai.anthropic.test.ts`:

```ts
// Primul test pe forma requestului catre Anthropic. Inainte de v2.43.3 niciun test
// nu mock-uia @anthropic-ai/sdk, deci max_tokens si orice camp nou de pe calea nativa
// erau complet nefixate (verificat: singurul import al SDK-ului era ai.ts:1).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted e OBLIGATORIU: fabrica `vi.mock` e ridicata deasupra declaratiilor de
// modul, deci un `const streamMock = vi.fn()` simplu ar fi in TDZ cand fabrica ruleaza.
// Acelasi tipar ca in ai.openrouter.test.ts:7-9.
const streamMock = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { stream: streamMock };
  },
}));

import { AI_MAX_TOKENS, callAnthropic, callModel } from "./ai.ts";

function mockFinalMessage(text = "ok") {
  return {
    finalMessage: async () => ({
      content: [{ type: "text", text }],
      usage: { input_tokens: 10, output_tokens: 20 },
      stop_reason: "end_turn",
    }),
  };
}

beforeEach(() => {
  streamMock.mockReset().mockReturnValue(mockFinalMessage());
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("callAnthropic — forma requestului", () => {
  it("trimite max_tokens din constanta partajata si foloseste streaming", async () => {
    const out = await callAnthropic("k".repeat(20), "claude-opus-5", "prompt", 5000);
    expect(out).toBe("ok");
    expect(streamMock).toHaveBeenCalledTimes(1);
    const body = streamMock.mock.calls[0][0] as Record<string, unknown>;
    expect(body.max_tokens).toBe(AI_MAX_TOKENS);
    expect(body.model).toBe("claude-opus-5");
  });

  it("output_config.effort DOAR pentru claude-sonnet-5 si claude-opus-5", async () => {
    for (const modelId of ["claude-sonnet-5", "claude-opus-5"]) {
      streamMock.mockClear().mockReturnValue(mockFinalMessage());
      await callAnthropic("k".repeat(20), modelId, "prompt", 5000, undefined, undefined, "medium");
      const body = streamMock.mock.calls[0][0] as Record<string, unknown>;
      expect(body.output_config).toEqual({ effort: "medium" });
    }
  });

  it("haiku 4.5 NU primeste output_config (ar da 400)", async () => {
    await callAnthropic(
      "k".repeat(20), "claude-haiku-4-5-20251001", "prompt", 5000, undefined, undefined, "medium"
    );
    const body = streamMock.mock.calls[0][0] as Record<string, unknown>;
    expect(body).not.toHaveProperty("output_config");
  });

  it("fara effort explicit nu se trimite output_config (default-ul serverului e high)", async () => {
    await callAnthropic("k".repeat(20), "claude-opus-5", "prompt", 5000);
    const body = streamMock.mock.calls[0][0] as Record<string, unknown>;
    expect(body).not.toHaveProperty("output_config");
  });

  it("AI_EFFORT_DISABLED=1 omite output_config chiar si pe un model capabil", async () => {
    process.env.AI_EFFORT_DISABLED = "1";
    try {
      await callAnthropic("k".repeat(20), "claude-opus-5", "prompt", 5000, undefined, undefined, "medium");
      const body = streamMock.mock.calls[0][0] as Record<string, unknown>;
      expect(body).not.toHaveProperty("output_config");
    } finally {
      // biome-ignore lint/performance/noDelete: env trebuie unset real
      delete process.env.AI_EFFORT_DISABLED;
    }
  });
});
```

- [ ] **Step 2: Ruleaza si confirma ca pica**

Run: `npx vitest run backend/src/services/ai.anthropic.test.ts`
Asteptat: TOATE pica — codul apeleaza `messages.create`, nu `messages.stream`, deci mock-ul nu inregistreaza
nimic. Harness-ul e nou si codul nu il satisface inca.

- [ ] **Step 3: Rescrie `callAnthropic`**

```ts
async function callAnthropic(
  apiKey: string,
  modelId: string,
  prompt: PromptInput,
  timeout = AI_TIMEOUT,
  tracking?: AiUsageTrackingContext,
  signal?: AbortSignal,
  effort?: AiEffort
): Promise<string> {
  const { system, user } = promptParts(prompt);
  return withAiLogging(
    "anthropic",
    modelId,
    async () => {
      const client = new Anthropic({ apiKey });
      // v2.43.3: streaming + finalMessage() in loc de messages.create. La 16000
      // max_tokens cu thinking adaptiv (pornit implicit pe Claude 5) un apel
      // non-streaming poate atinge timeout-ul de request inainte sa termine faza de
      // gandire. Valoarea de retur e identica; NU se face SSE spre client.
      const sendEffort = effort !== undefined && !effortDisabled() && EFFORT_CAPABLE_MODEL_IDS.has(modelId);
      const message = await client.messages
        .stream(
          {
            model: modelId,
            max_tokens: AI_MAX_TOKENS,
            // v2.42.0 (5.6): system prompt nativ Anthropic.
            ...(system !== null ? { system } : {}),
            messages: [{ role: "user", content: user }],
            // Doar pentru modelele care il suporta — vezi EFFORT_CAPABLE_MODEL_IDS.
            ...(sendEffort ? { output_config: { effort } } : {}),
          },
          { signal: composeSignal(timeout, signal) }
        )
        .finalMessage();
      const value = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
      return {
        value,
        meta: {
          usageInput: message.usage?.input_tokens,
          usageOutput: message.usage?.output_tokens,
          stopReason: message.stop_reason ?? undefined,
        },
      };
    },
    tracking
  );
}
```

- [ ] **Step 4: Ruleaza si confirma verde**

Run: `npx vitest run backend/src/services/ai.anthropic.test.ts backend/src/services/ai.test.ts`

- [ ] **Step 5: Gate + commit**

```bash
npx biome check --write backend/src/services/ai.ts backend/src/services/aiUsage.ts backend/src/services/ai.anthropic.test.ts
npx tsc --noEmit -p backend/tsconfig.json
npm run build
npm test --workspace=backend
git add backend/src/services/ai.ts backend/src/services/aiUsage.ts backend/src/services/ai.anthropic.test.ts
git commit -m "feat(ai): output_config.effort pe allowlist nativ + streaming pe callAnthropic"
```

---

## Task 4: Threading-ul lui `effort` prin `callModel`

**Files:**
- Modify: `backend/src/services/ai.ts:805-833` (`callModel`)
- Test: `backend/src/services/ai.anthropic.test.ts` (1 test nou, prin `callModel`)

**Interfaces:**
- Produce: `callModel(modelKey, prompt, apiKeys, timeout?, tracking?, signal?, routing?, effort?)`.

**De reținut:** ramurile native paseaza SASE argumente azi (`ai.ts:829-831`), OpenRouter SAPTE (`:824`).
`effort` devine al 7-lea pe native, al 8-lea pe OpenRouter. `callOpenAI` si `callGoogle` NU primesc effort —
calibrarea lor e follow-up separat; comentariu la call site ca sa nu se presupuna paritate.

- [ ] **Step 1: Testul care pica**

```ts
  it("callModel propaga effort pe ruta nativa Anthropic", async () => {
    await callModel(
      "claude-opus", "prompt", { anthropic: "k".repeat(20) }, 5000, undefined, undefined, undefined, "medium"
    );
    const body = streamMock.mock.calls[0][0] as Record<string, unknown>;
    expect(body.output_config).toEqual({ effort: "medium" });
  });
```

- [ ] **Step 2: Ruleaza — pica pe argumentul in plus, ignorat**

Run: `npx vitest run backend/src/services/ai.anthropic.test.ts -t "callModel propaga"`

- [ ] **Step 3: Extinde `callModel`**

Adauga `effort?: AiEffort` ca ultim parametru si paseaza-l:

```ts
    return callOpenRouter(apiKey, slug, prompt, timeout, tracking, signal, "openrouter:western", effort);
```

```ts
  if (model.provider === "anthropic")
    return callAnthropic(apiKey, model.modelId, prompt, timeout, tracking, signal, effort);
  // GPT-5.6 (Responses API `reasoning`) si Gemini (`thinkingConfig`) NU primesc effort:
  // calibrarea lor e follow-up separat. Nu presupune paritate cu ruta Anthropic.
  if (model.provider === "openai") return callOpenAI(apiKey, model.modelId, prompt, timeout, tracking, signal);
  if (model.provider === "google") return callGoogle(apiKey, model.modelId, prompt, timeout, tracking, signal);
```

- [ ] **Step 4: Verde + gate + commit**

```bash
npx vitest run backend/src/services/ai.anthropic.test.ts
npx biome check --write backend/src/services/ai.ts backend/src/services/ai.anthropic.test.ts
npx tsc --noEmit -p backend/tsconfig.json && npm run build && npm test --workspace=backend
git add backend/src/services/ai.ts backend/src/services/ai.anthropic.test.ts
git commit -m "feat(ai): callModel propaga effort spre ruta nativa si OpenRouter"
```

---

## Task 5: effort pe rol — `low` analisti si single, `medium` judge

**Files:**
- Modify: `backend/src/routes/ai.ts:216-224` (single), `:344-355` (analist A), `:359-370` (analist B),
  `:386-397` (judge)

**Decizie user (2026-07-26):** `low` pe analiza single si pe cei doi analisti, `medium` pe judge.

**Doua semnale de regresie de urmarit dupa deploy, distincte:**
(1) pe analisti/single — analiza devine superficiala, sare peste elemente din dosar, sau explica generic in loc
de specific. Se vede DOAR citind analize reale, nu din metrici. Daca apare, urca analistii la `medium`.
(2) pe judge — sectiunea "Revizuire si reconciliere" devine formala sau goala pe dosare unde cele doua analize
chiar difera. Daca apare, urca judge-ul la `high`.

- [ ] **Step 1: Adauga effort-ul potrivit ca ultim argument, per rol**

Single (`:216-224`) — `"low"`:

```ts
    const text = await callModel(
      modelKey || "claude-sonnet",
      prompt,
      keys,
      AI_TIMEOUT,
      tracking,
      c.req.raw.signal,
      routing,
      // v2.43.3: `low` — extrage si explica din datele dosarului, fara reconciliere.
      // Default-ul serverului ar fi `high`; asta e o reducere deliberata de cost.
      "low"
    );
```

Analist A (`:344-355`) si analist B (`:359-370`) — identic, `"low"` dupa `routing,`.

Judge (`:386-397`) — `"medium"`, cu comentariu care explica DE CE difera de analisti:

```ts
          judgeAbort.signal,
          routing,
          // v2.43.3: judge-ul ramane peste analisti. El reconciliaza doua analize care
          // pot sa se contrazica — detecteaza contradictii si le cantareste, pasul unde
          // thinking-ul chiar isi merita costul. Analistii ruleaza pe `low`.
          "medium"
```

- [ ] **Step 2: Verifica testele de contract**

Run: `npx vitest run backend/src/routes/ai.contract.test.ts backend/src/routes/ai.settings.test.ts`
Asteptat: PASS neschimbat — testele de contract se opresc pe validare inainte de orice apel de provider
(verificat: nu mock-uiesc niciun SDK).

- [ ] **Step 3: Gate + commit**

```bash
npx biome check --write backend/src/routes/ai.ts
npx tsc --noEmit -p backend/tsconfig.json && npm run build && npm test --workspace=backend
git add backend/src/routes/ai.ts
git commit -m "feat(ai): effort low pe analisti si single, medium pe judge"
```

---

## Task 6: Observabilitate — `stopReason` in `ai_call` (calea de succes) + eroare pe raspuns gol

**Files:**
- Modify: `backend/src/services/ai.ts:674-695` (diagnosticul `openrouter_empty_content`)
- Modify: `backend/src/services/ai.ts` — `callOpenRouter` pune `finish_reason` in meta
- Modify: `backend/src/routes/ai.ts` (Step 3 — eroare pe analiza goala, fluxul single)
- Modify: `backend/src/util/envelope.ts` (cod de eroare nou — `AI_EMPTY_RESPONSE` NU exista azi, verificat la `:21-41`)
- Test: `backend/src/services/ai.openrouter.test.ts` (1 test), `backend/src/routes/ai.contract.test.ts` (1 test)

`aiUsage.ts` NU se mai atinge in acest task — campul de tip a fost mutat in Task 3 Step 0.

Campul `stopReason` din `AiUsageCallMeta` a fost adaugat deja in Task 3 Step 0.

**CORECTIE dupa review adversarial (MEDIUM) — descoperirea B era corecta ca mecanism, gresita ca concluzie.**
Calea de succes face `...meta` (camp nou apare automat), calea de eroare construieste obiectul explicit. DAR:
nu exista niciun producator de `stopReason` pe calea de eroare. Anthropic livreaza `stop_reason` intr-un mesaj
final REUSIT; OpenRouter livreaza `finish_reason` pe `choice`, tot pe succes. `withAiLogging` primeste in catch
doar eroarea aruncata (`ai.ts:389-450`), iar niciun apelant nu ataseaza `stopReason` acelei erori.

Consecinta: `stopReason` ramane DOAR pe calea de succes, unde ajunge automat prin spread. NU se adauga nimic pe
calea de eroare si NU se scrie testul care ataseaza artificial `stopReason` unui `Error` — ar fi validat o cale
pe care nimic nu o produce. Semnalul cautat (trunchierea, `stop_reason: "max_tokens"`) vine pe raspunsuri de
succes, deci acoperirea e completa fara el.

**Descoperirea C:** `recordAiUsageSafely` destructureaza doar campurile cunoscute, deci `stopReason` ajunge in
linia `ai_call` de pe stdout dar NU in `ai_usage`. Intentionat: semnal de diagnostic, nu metrica de facturat.
NU adauga coloana in DB.

- [ ] **Step 1: `finish_reason` in meta pe ruta OpenRouter**

In `callOpenRouter`, in obiectul de meta returnat: `stopReason: choice?.finish_reason ?? undefined`.
(Pe ruta Anthropic `stopReason` a fost pus deja in Task 3.)

Testul, in `ai.openrouter.test.ts` — foloseste helper-ul REAL `mockOpenRouterResponse(...)`, care NU intoarce
un obiect, ci configureaza mockul intern:

```ts
  it("F-C: finish_reason ajunge in linia de log ai_call", async () => {
    openRouterCreateMock.mockResolvedValueOnce({
      choices: [{ message: { content: "ok" }, finish_reason: "length" }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    });
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => {
      logs.push(a.map(String).join(" "));
    });
    try {
      await callOpenRouter("k".repeat(20), "anthropic/claude-opus-5", "prompt", 5000);
      const line = logs.find((l) => l.includes('"action":"ai_call"'));
      expect(line).toContain('"stopReason":"length"');
    } finally {
      spy.mockRestore();
    }
  });
```

`ai.openrouter.test.ts` importa deja `vi` — verifica inainte de a scrie. (`aiUsage.test.ts:5` NU il importa;
daca ajungi sa adaugi ceva acolo, adauga si importul.)

- [ ] **Step 2: Extinde diagnosticul de raspuns gol cu effort-ul trimis**

In blocul `openrouter_empty_content` (`ai.ts:674-695`), la finalul listei de argumente:

```ts
          "effort_sent:",
          sendEffort ? effort : "none"
```

Motiv: cand un raspuns vine gol vrei sa stii daca effort-ul a fost trimis, altfel debugging-ul e ghicit.

- [ ] **Step 3: Eroare pe analiza goala, DOAR pe fluxul single**

**CORECTAT dupa review adversarial (HIGH).** Varianta initiala cerea o "eroare tipata... dupa un apel cu
reasoning activ", dar `callModel` intoarce doar `string` si nu comunica rutei daca effort-ul a fost trimis, iar
`callOpenRouter` e comun rutelor single si multi. Conditionarea pe "reasoning activ" e deci neimplementabila —
si inutila: ruta single stie ce a cerut, si un raspuns gol e eroare indiferent de cauza.

In `backend/src/routes/ai.ts`, imediat dupa `callModel` pe `/analyze` (`:216-224`):

```ts
    // v2.43.3: un raspuns gol nu mai iese ca 200 {"analysis":""}. Pe Claude 5 thinking-ul
    // consuma din acelasi buget ca textul, deci un raspuns gol e semnal de trunchiere sau
    // de refuz al modelului, nu un rezultat valid. Pe MULTI nu se schimba nimic: promptul
    // judge are deja regula pentru analiza goala (ai.ts:323), deci degradarea e by design.
    if (!text.trim()) {
      return c.json(fail(ErrorCodes.AI_EMPTY_RESPONSE, "Modelul a returnat un raspuns gol. Reincearca.", c), 502);
    }
```

`AI_EMPTY_RESPONSE` NU exista in `ErrorCodes` (`backend/src/util/envelope.ts:21-41`, verificat) — adauga-l
langa celelalte coduri, in acelasi stil `AI_EMPTY_RESPONSE: "AI_EMPTY_RESPONSE"`.

**Testul, concret** (nu "decide la implementare"): in `ai.contract.test.ts` fisierul nu mock-uieste niciun SDK,
dar poate mock-ui PROPRIUL serviciu. Adauga un mock partial care lasa restul modulului intact:

```ts
vi.mock("../services/ai.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/ai.ts")>();
  return { ...actual, callModel: vi.fn(async () => "   ") };
});
```

apoi loveste `POST /analyze` cu un body valid si o cheie prezenta, si asteapta `502` cu
`error.code === "AI_EMPTY_RESPONSE"`. Verifica in `ai.contract.test.ts` daca `vi` e deja importat; daca nu,
adauga-l.

- [ ] **Step 5: Verde + gate + commit**

```bash
npx vitest run backend/src/services/ai.openrouter.test.ts backend/src/routes/ai.contract.test.ts
npx biome check --write backend/src/services/ai.ts backend/src/routes/ai.ts backend/src/util/envelope.ts backend/src/services/ai.openrouter.test.ts backend/src/routes/ai.contract.test.ts
npx tsc --noEmit -p backend/tsconfig.json && npm run build && npm test --workspace=backend
git add backend/src/services/ai.ts backend/src/routes/ai.ts backend/src/util/envelope.ts backend/src/services/ai.openrouter.test.ts backend/src/routes/ai.contract.test.ts
git commit -m "feat(ai): stopReason in ai_call pe calea de succes + eroare pe raspuns gol pe fluxul single"
```

---

## Task 7: Kill switch documentat

**Files:**
- Modify: `SESSION-HANDOFF.md` (tabelul "Kill switches operationale", in jur de `:425`)

`AI_EFFORT_DISABLED` e implementat in Task 2 (`effortDisabled()`). Aici doar se documenteaza — tabelul din
SESSION-HANDOFF e sursa unica pentru kill switches, iar CLAUDE.md nu duplica lista.

- [ ] **Step 1: Rand nou in tabel, in acelasi format**

```
| `AI_EFFORT_DISABLED=1` | `callAnthropic` si `callOpenRouter` omit campurile de effort (`output_config` / `reasoning`); modelele revin la default-ul serverului, care e `high` | Rollback fara rebuild daca `medium` degradeaza calitatea analizei sau daca un provider incepe sa respinga campul |
```

- [ ] **Step 2: Commit**

```bash
git add SESSION-HANDOFF.md
git commit -m "docs: AI_EFFORT_DISABLED in tabelul de kill switches"
```

---

## Task 8: Canary live + inchidere

Nu se poate automatiza — cere cheile userului. Se face inainte de a declara fluxul incheiat.

- [ ] **Step 1: Canary OpenRouter**

**ATENTIE — criteriul naiv da FALS POZITIV (finding review adversarial, HIGH).** `cost_usd_milli` din
`ai_usage` e NENUL si azi: cand providerul nu trimite cost, `aiUsage.ts:188-196` cade pe tabelul static de
preturi. Testul `ai.openrouter.test.ts:221` confirma explicit un cost DB de 3000 fara `usage.cost`. Deci un
rand cu cost nenul NU dovedeste nimic.

Locul decisiv e linia de log `ai_call` de pe stdout, nu randul din DB: `meta.costUsdMilli` se seteaza EXCLUSIV
din `usage.cost` (`ai.ts:701` — `usage?.cost != null ? ... : null`), iar calea de succes din `withAiLogging`
face spread pe meta. Deci:

Un apel live prin aplicatie pe `anthropic/claude-opus-5` care confirma:
(a) in linia `ai_call` de pe stdout, `costUsdMilli` e NENUL — asta dovedeste ca valoarea vine de la provider,
    nu din tabel. Inainte de fix campul era mereu `null` acolo. Compara si cu ce ar fi dat tabelul static: daca
    difera, confirmarea e dubla;
(b) cum traduce OpenRouter `reasoning.effort` pentru Claude 5 — inspecteaza reasoning details din raspuns.
Daca se dovedeste ca il traduce intr-un budget fix, reevalueaza daca merita pastrat pe ruta aia.

Premisa 7: asta NU a putut fi pre-verificat (MCP-ul OpenRouter da 401), deci e primul lucru care poate
invalida Task 2. Fa-l inaintea restului canary-ului.

- [ ] **Step 2: Canary nativ**

Cate un apel per model din allowlist (`claude-sonnet-5`, `claude-opus-5`) care confirma ca `output_config` e
acceptat fara beta header si ca streaming-ul intoarce acelasi tip de rezultat.

- [ ] **Step 3: Gate complet + bump de versiune**

Fluxul C livreaza un release, deci se aplica `## Checklist bump de versiune` din CLAUDE.md (package.json x3 +
lockfile, changelog in-app, CHANGELOG.md, README, SESSION-HANDOFF, STATUS.md, DOCUMENTATIE.md). Sanity check:
`grep -i "2.43.2"` pe toate `.md` de la radacina.

## Definition of done

- [ ] `AI_MAX_TOKENS` exportat, 16000; `TRUNCATE_ANALYSIS` NEATINS la 50000; testul care hardcoda 8000 foloseste constanta
- [ ] Body OpenRouter: `usage` top-level, `extra_body` ABSENT, `reasoning.effort` doar pe allowlist exact
- [ ] `output_config.effort` nativ doar pe `claude-sonnet-5` / `claude-opus-5`; haiku negativ testat
- [ ] `callAnthropic` pe streaming + `finalMessage()`
- [ ] Harness nou de mock pe `@anthropic-ai/sdk` — prima acoperire pe forma requestului nativ
- [ ] `AI_EFFORT_DISABLED=1` omite effort pe ambele rute, cu test pe FIECARE (nativ in `ai.anthropic.test.ts`, OpenRouter in `ai.openrouter.test.ts`)
- [ ] effort pe rol: `low` pe single + cei doi analisti, `medium` pe judge
- [ ] `stopReason` in `ai_call` pe calea de SUCCES (Anthropic + OpenRouter); NU pe calea de eroare (niciun producator), NU in `ai_usage`
- [ ] Eroare `AI_EMPTY_RESPONSE` (502) pe fluxul single la raspuns gol, cu test
- [ ] Canary live: `costUsdMilli` NENUL in linia `ai_call` de pe stdout (NU randul din DB — acela e nenul si
      azi, prin fallback pe tabelul static) + `output_config` acceptat nativ
- [ ] Gate verde fara regresii fata de 2091 backend / 395 frontend
- [ ] Commituri separate per task, pe `feat/v2.43.0-rnpm-split`, NU pe `main`, nepushuite
