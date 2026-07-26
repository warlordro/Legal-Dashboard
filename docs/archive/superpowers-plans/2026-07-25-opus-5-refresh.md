# Plan — Claude Opus 4.8 → Opus 5 in analiza AI

**Data:** 2026-07-25. **Branch:** `feat/v2.43.0-rnpm-split`.
**Status:** revizuit dupa reviewul Fable 5 (v2). D3 si D4 aprobate de user pe 2026-07-25.
Executia NU a inceput — vezi [HANDOFF-OPUS-5-REFRESH-2026-07-25.md](../../archive/HANDOFF-OPUS-5-REFRESH-2026-07-25.md).

## Obiectiv

Modelul "Premium" din analiza AI (single-agent, analist multi-agent si judecator) ruleaza pe
Claude Opus 5, atat nativ Anthropic cat si prin OpenRouter, cu pricing corect in `ai_usage` si
fara etichete stale in UI / manual / documentatie.

**Criteriu de merge (blocant):** `npm run check` verde + biome curat +
`grep -riE "opus[ .-]?4[.-]8"` nu mai returneaza niciun hit in cod activ (doar istoric changelog +
artefacte HTML, vezi "Ce NU face acest plan").

**Criteriu de confirmare live (nu blocheaza merge-ul, dar e singura dovada empirica a pricing-ului):**
o analiza reala pe ruta **nativa** care scrie in `ai_usage` un rand `claude-opus-5` cu cost nenul.
Vezi Pas 9 pentru de ce ruta OpenRouter nu poate confirma acelasi lucru.

## Date verificate

Sursa primara: documentatia Anthropic (`platform.claude.com/docs/en/about-claude/models/overview`,
consultata 2026-07-25). Sursa secundara: catalogul live OpenRouter.

| Camp | Valoare | Sursa |
|---|---|---|
| Model id nativ (Claude API ID) | `claude-opus-5` | Anthropic docs |
| Alias nativ | `claude-opus-5` (identic; format dateless, snapshot pinned) | Anthropic docs |
| Slug OpenRouter | `anthropic/claude-opus-5` | OpenRouter |
| Canonical slug OpenRouter | `anthropic/claude-opus-5-20260723` | OpenRouter |
| Pricing | $5 input / $25 output per 1M — **identic cu Opus 4.8** | Anthropic docs + OpenRouter |
| Context / max output | 1.000.000 tokens / 128k | ambele |

Doua consecinte directe:

1. Pricing-ul nu se schimba, deci nu e nevoie de recalibrarea quotelor per user (politica $5/user
   ramane valida). In plus, rezervarea de quota e **flat per feature**, nu per model
   (`quotaGuard.ts:57-60`: `ai.single` 250 milli, `ai.multi` 500 milli), deci paritatea de pret nu
   atinge deloc calea de rezervare; conteaza doar la confirm, unde costul real inlocuieste estimarea.
2. Model id-ul nativ **nu mai e inferenta**. In v1 a acestui plan era dedus din slug-ul canonical
   OpenRouter, ceea ce era un risc real: repo-ul foloseste conventii mixte
   (`claude-haiku-4-5-20251001` datat vs `claude-sonnet-5` dateless). Acum e confirmat de sursa
   primara.

Nota: Opus 4.8 a trecut in tabelul "Legacy models" al Anthropic. Ramane disponibil, nu e deprecated
si nu are data de retragere anuntata.

## Decizii de arhitectura

### D1 — Cheia interna ramane `claude-opus` (recomandat)

Precedentul din repo e mixt: `claude-sonnet` (cheie nevesionata) a supravietuit trecerii
Sonnet 4.6 → Sonnet 5 schimband doar `modelId` (vezi comentariul din `ai.ts:19-21`), pe cand
`gpt-5.6-*` si `gemini-flash-3.6` folosesc chei versionate.

Cheia Opus e azi `claude-opus`, adica exact tiparul Sonnet. Motivele concrete pentru care o pastram:

1. Selectiile salvate in UI raman valide fara re-mapare.
2. `JUDGE_MODELS` (`ai.ts:41`) contine `"claude-opus"`; o cheie noua ar cere edit sincron acolo.
3. `useDosareAi.ts:76` are `multiJudge` default `"claude-opus"`; o cheie noua ar rupe default-ul.

**Corectie fata de v1:** justificarea "istoricul `ai_usage` nu are discontinuitate de cheie" era
falsa si e eliminata. `callModel` (`ai.ts:826`) paseaza `model.modelId` (nativ) sau slug-ul
(OpenRouter) in tracking — coloana `ai_usage.model` **nu** contine niciodata cheia interna. Deci
istoricul se va imparti oricum intre `claude-opus-4-8` si `claude-opus-5`, exact cum s-a intamplat
si la Sonnet. E comportament asteptat, nu regresie, si nu depinde de decizia D1.

Alternativa respinsa: cheie noua `claude-opus-5`. Cheile versionate au sens doar cand coexista mai
multe variante ale aceleiasi familii (Luna/Terra/Sol), ceea ce nu e cazul aici.

### D2 — Intrarile de pricing 4.8 raman in tabel

Se ADAUGA `claude-opus-5` / `anthropic/claude-opus-5`; intrarile 4.8 nu se sterg.

**Corectie fata de v1:** motivul invocat atunci ("retry-uri si cozi in zbor") nu e sustinut de cod —
`modelId` se rezolva din `AI_MODELS` la momentul apelului, nu exista coada persistata care sa poarte
un modelId vechi. Motivele reale:

1. Tiparul casei — `claude-sonnet-4-6`, `gpt-5.4-*`, `gemini-3.5-flash` au fost toate pastrate.
2. `OPENROUTER_MODEL_OVERRIDES` permite unui operator sa repina `claude-opus` inapoi pe slug-ul 4.8
   fara rebuild; daca stergem intrarea, acel rollback ar scrie tacit cost 0.

Costul deciziei e o linie de tabel. Comentariul in cod ramane in stilul existent al vecinilor.

### D3 — Copy stale in mesajul de eroare al judecatorului — **APROBAT**

`backend/src/routes/ai.ts:282` spune azi: *"Doar Claude Opus 4.8, GPT-5.4 si Gemini 3.1 Pro."*

`GPT-5.4` e stale: `JUDGE_MODELS` contine `gpt-5.6-sol`, iar copy-ul din frontend
(`manual-content.tsx:566`, `export-manual.ts:375`) spune deja corect "GPT-5.6 Sol". Rescriu oricum
acest literal pentru Opus, deci propun sa corectez si `GPT-5.4` → `GPT-5.6 Sol` in aceeasi linie.
A-l lasa pe jumatate corect ar fi o inconsecventa introdusa constient.

### D4 — Fara bump de versiune — **APROBAT**

Precedentul imediat `87f5f94` (Gemini 3.1 Flash Lite → 3.5 Flash Lite) a fost livrat inclus in
v2.43.2, extinzand entry-ul de changelog existent. Recomand acelasi tratament. Alternativa (bump la
v2.43.3) declanseaza checklistul complet de release din CLAUDE.md, 7 fisiere obligatorii, pentru un
swap de model id — disproportionat.

## Pasi de executie

### Pas 1+2 — Backend: catalog + rutare + pricing (**un singur commit**)

Cele doua nu se separa: un build intre ele ar rula Opus 5 fara intrare de pricing, deci ar scrie
cost 0 + warn. `87f5f94` a livrat de altfel catalog + pricing + UI impreuna.

`backend/src/services/ai.ts:23` — `modelId: "claude-opus-4-8"` → `"claude-opus-5"`.
`backend/src/services/ai.ts:46` — `"anthropic/claude-opus-4.8"` → `"anthropic/claude-opus-5"`.
`backend/src/services/aiUsage.ts:46` — adauga `"claude-opus-5": { 5, 25 }` (dupa `claude-opus-4-8`, care ramane).
`backend/src/services/aiUsage.ts:78` — adauga `"anthropic/claude-opus-5": { 5, 25 }` (dupa `anthropic/claude-opus-4.8`, care ramane).

Comentariu scurt in stilul vecinilor (cheia interna ramane, se schimba doar modelId; data
verificarii pricing-ului).

**Verificare:** `npx tsc --noEmit -p backend/tsconfig.json` + testul existent de pricing lookup;
nicio intrare 4.8 stearsa.

### Pas 3 — Backend: mesaj judecator

`backend/src/routes/ai.ts:282` → `"Model judecator nepermis. Doar Claude Opus 5, GPT-5.6 Sol si
Gemini 3.1 Pro."` (include corectia D3 daca e aprobata; altfel doar `4.8` → `5`).

**Verificat:** string-ul **nu** e asertat in niciun test. `grep "judecator nepermis"` returneaza doar
`ai.ts:282` plus doua documente de plan. `ai.contract.test.ts:98` trimite `judge: "claude-opus"`,
adica cheia interna — neafectat de schimbarea de label.

### Pas 4 — Frontend: labels

`frontend/src/components/dosare-ai-config.ts:21` — label `"Opus 4.8"` → `"Opus 5"`.
`frontend/src/components/dosare-ai-config.ts:47` — label `"Claude Opus 4.8"` → `"Claude Opus 5"`.

**Verificare:** `cd frontend && npx tsc --noEmit`.

### Pas 5 — Frontend: manual + export

`frontend/src/pages/manual-content.tsx:507` — `"Claude Opus 5 — Premium (cel mai detaliat)"`.
`frontend/src/pages/manual-content.tsx:566` — `Claude Opus 4.8` → `Claude Opus 5`.
`frontend/src/lib/export-manual.ts:348` — `Opus 4.8 (Premium)` → `Opus 5 (Premium)`.
`frontend/src/lib/export-manual.ts:375` — `Claude Opus 4.8` → `Claude Opus 5`.

### Pas 6 — Teste

Obligatoriu (asserteaza direct valorile schimbate):

| Fisier:linie | Schimbare |
|---|---|
| `backend/src/services/ai.openrouter.test.ts:136` | slug asteptat → `anthropic/claude-opus-5` |
| `frontend/src/components/dosare-ai-config.test.ts:16` | titlu `it(...)` → "Opus 5" |
| `frontend/src/components/dosare-ai-config.test.ts:17` | label → `"Opus 5"` |
| `frontend/src/components/dosare-ai-config.test.ts:44` | titlu `it(...)` → "Opus 5" |
| `frontend/src/components/dosare-ai-config.test.ts:45` | label judecator → `"Claude Opus 5"` |

Neatinse (folosesc `anthropic/claude-opus-4.8` doar ca fixture, iar intrarea de pricing 4.8 ramane
in tabel conform D2, deci trec neschimbate): `backend/src/services/aiUsage.test.ts:141,171` si
`backend/src/db/aiUsageRepository.test.ts:72`. Decizia: nu ating cod fara motiv.

**Verificare:** `npm run test:backend` + `npm run test:frontend`.

### Pas 7 — Documentatie

`DOCUMENTATIE.md:295` — randul din tabelul de modele: `Claude Opus 5 (Premium)` / `claude-opus` /
`claude-opus-5`.
`CHANGELOG.md` + `frontend/src/data/changelog-entries.tsx` — extind entry-ul v2.43.2 cu refresh-ul
Opus (daca D4 = fara bump), exact ca la Lite in `87f5f94`.

Nu ating `changelog-entries.tsx:279` si entry-urile v2.38.0 din `CHANGELOG.md` — sunt inregistrari
istorice, descriu corect ce s-a livrat atunci.

### Pas 8 — Gate pre-push (non-negociabil, ordinea din CLAUDE.md)

1. `npx biome check --write` pe fisierele atinse
2. `npx tsc --noEmit -p backend/tsconfig.json` + `cd frontend && npx tsc --noEmit`
3. `npm run build`
4. `npm run test:backend` + `npm run test:frontend`

Plus, inainte de commit: `grep -riE "opus[ .-]?4[.-]8"` pe repo, ignorand hiturile istorice
enumerate mai jos. Regexul din v1 (`-i "opus 4.8"`) era rupt: nu prindea nici `claude-opus-4-8`,
nici `anthropic/claude-opus-4.8`, adica exact identificatorii pe care ii schimbam.

### Pas 9 — Confirmare live (recomandat)

O analiza reala pe ruta **nativa**, apoi verificat ca `ai_usage` are un rand `claude-opus-5` cu cost
nenul.

De ce doar nativ: pe ruta OpenRouter, `costUsdMilli` vine direct din `usage.cost` al raspunsului
(`ai.ts:698`), iar `directCostUsdMilli ?? estimateAiCostUsdMilli(...)` (`aiUsage.ts:182-189`)
scurtcircuiteaza tabelul de preturi. Un smoke OpenRouter deci **nu** valideaza intrarea
`anthropic/claude-opus-5` din tabel; aceea ramane acoperita doar de testul de lookup din Pas 1+2.

### Verificare operationala (in afara repo-ului)

`OPENROUTER_MODEL_OVERRIDES` poate repina `claude-opus` pe orice slug fara rebuild. In repo e curat:
`.env.example:87` si `backend/.env.example:34` sunt goale, niciun deploy config committed nu pineaza
`claude-opus`. Dar mediul de productie nu e vizibil din repo. Inainte de a declara live-ul confirmat,
de verificat ca env-ul de deploy nu contine `claude-opus:...`; daca il contine, fie se scoate, fie se
actualizeaza pe `anthropic/claude-opus-5`.

## Riscuri

| Risc | Impact | Mitigare |
|---|---|---|
| Intrare de pricing ratata sau override care pineaza un slug fara pret | cost 0 in `ai_usage`, quota nu se consuma | Warn one-shot `ai_usage.price_missing` (`aiUsage.ts:151`) in log la primul call; verificat la Pas 9 |
| Model id nativ gresit | 404 la Anthropic direct | Redus substantial: id-ul e confirmat de docs Anthropic. Detectia in caz de esec **nu** e warn-ul de pricing (un 404 da 0/0 tokeni, deci `return 0` la `aiUsage.ts:163` fara warn), ci `"action":"ai_call","status":"error"` in log |
| Label uitat intr-un colt de UI | inconsecventa vizibila | `grep -riE "opus[ .-]?4[.-]8"` inainte de commit |

## Ce NU face acest plan

Nu atinge `claude-haiku`, `claude-sonnet`, familia GPT sau Gemini. Nu schimba `JUDGE_MODELS`,
politica de quota sau limitele de tokeni. Nu sterge intrari de pricing existente.

Nu atinge artefactele HTML de prezentare (`Legal-Dashboard-Prezentare.html:362`,
`Legal-Dashboard-v2.42.0-Fixuri-Post-Review.html`) si nici planurile/handoff-urile istorice din
`docs/superpowers/` si radacina. Sunt instantanee ale unui moment trecut. Precedentul confirma
alegerea: nici `87f5f94`, nici `c70ee44` nu le-au atins. Le enumar aici tocmai ca sa nu apara ca
surpriza in grep-ul pre-commit.
