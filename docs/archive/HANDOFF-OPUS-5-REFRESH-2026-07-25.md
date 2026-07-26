# Handoff — Claude Opus 4.8 → Opus 5 in analiza AI

**Data:** 2026-07-25. **Branch:** `feat/v2.43.0-rnpm-split`. **Autor handoff:** sesiune Claude Opus 5.
**Stare:** plan aprobat, decizii inchise, **zero cod modificat**. Documentul e suficient ca sa executi
fara context de chat.

Plan detaliat cu rationamentul complet: [docs/superpowers/plans/2026-07-25-opus-5-refresh.md](docs/superpowers/plans/2026-07-25-opus-5-refresh.md).
Acest handoff e varianta operationala: ce se schimba, unde, in ce ordine, ce verifici.

## 1. Ce livram

Slotul "Premium" Anthropic din analiza AI (single-agent, analist multi-agent si judecator) trece de
pe Claude Opus 4.8 pe Claude Opus 5, atat pe provider-ul nativ cat si pe rutarea OpenRouter, cu
pricing corect in `ai_usage` si fara etichete stale in UI, manual, export PDF si documentatie.

Inclus in **v2.43.2, fara bump de versiune** (precedent `87f5f94`).

## 2. Decizii inchise (nu le redeschide)

| # | Decizie | Stare |
|---|---|---|
| D1 | Cheia interna ramane `claude-opus`; se schimba doar `modelId` si slug-ul OpenRouter | Inchisa (precedent Sonnet 4.6 → 5) |
| D2 | Intrarile de pricing 4.8 raman in tabel; se ADAUGA cele pentru Opus 5 | Inchisa |
| D3 | In acelasi string se corecteaza si `GPT-5.4` stale → `GPT-5.6 Sol` | **Aprobat de user 2026-07-25** |
| D4 | Fara bump de versiune; se extinde entry-ul v2.43.2 existent | **Aprobat de user 2026-07-25** |

De ce D1: selectiile salvate in UI raman valide, `JUDGE_MODELS` (`backend/src/services/ai.ts:41`)
contine `"claude-opus"`, iar `useDosareAi.ts:76` are `multiJudge` default `"claude-opus"`. O cheie
versionata noua ar cere edit sincron in toate trei si ar rupe default-ul judecatorului fara castig.

De ce D2: `OPENROUTER_MODEL_OVERRIDES` permite unui operator sa repina `claude-opus` inapoi pe
slug-ul 4.8 fara rebuild; daca stergem intrarea de pricing, acel rollback ar scrie tacit cost 0.
Plus consistenta cu tiparul casei (`claude-sonnet-4-6`, `gpt-5.4-*`, `gemini-3.5-flash` toate pastrate).

## 3. Date verificate la sursa

Sursa primara: documentatia Anthropic (`platform.claude.com/docs/en/about-claude/models/overview`,
consultata 2026-07-25). Sursa secundara: catalogul live OpenRouter.

| Camp | Valoare |
|---|---|
| Model id nativ (Claude API ID) | `claude-opus-5` |
| Alias nativ | `claude-opus-5` (identic; format dateless, snapshot pinned) |
| Slug OpenRouter | `anthropic/claude-opus-5` |
| Canonical slug OpenRouter | `anthropic/claude-opus-5-20260723` |
| Pricing | $5 input / $25 output per 1M — **identic cu Opus 4.8** |
| Context / max output | 1.000.000 tokens / 128k |

Pricingul fiind identic, quota per user nu se recalibreaza. In plus rezervarea de quota e flat per
feature, nu per model (`backend/src/middleware/quotaGuard.ts:57-60`: `ai.single` 250 milli,
`ai.multi` 500 milli), deci paritatea de pret nu atinge deloc calea de rezervare — conteaza doar la
confirm, unde costul real inlocuieste estimarea.

Opus 4.8 a trecut in tabelul "Legacy models" al Anthropic. Ramane disponibil, nu e deprecated, nu are
data de retragere anuntata.

## 4. Executie

**Totul intra intr-un singur commit.** Cei cinci pasi de mai jos sunt grupuri logice de edituri, nu
commituri separate. Doua motive: precedentele `87f5f94` si `c70ee44` au livrat fiecare catalog +
pricing + UI + teste + docs intr-un commit; si, mai important, arborele e intentionat rosu intre
pasi. Dupa Pasii 1-3 testele din Pasul 4 inca asserteaza valorile vechi si pica. Gate-ul din
sectiunea 5 se ruleaza **o singura data, dupa Pasul 5**, nu dupa fiecare pas.

Toate liniile de mai jos sunt verificate pe HEAD-ul curent al branch-ului. Daca un numar de linie nu
mai corespunde, cauta cu `grep -riE "opus[ .-]?4[.-]8"`.

### Pas 1 — backend: catalog + rutare + pricing

Cele patru edituri sunt inseparabile chiar si logic: daca ai construi vreodata arborele cu catalogul
schimbat dar pricingul nu, Opus 5 ar rula fara intrare de pret, deci ar scrie cost 0 si ar emite warn.

| Fisier:linie | Din | In |
|---|---|---|
| `backend/src/services/ai.ts:23` | `modelId: "claude-opus-4-8"` | `modelId: "claude-opus-5"` |
| `backend/src/services/ai.ts:46` | `"anthropic/claude-opus-4.8"` | `"anthropic/claude-opus-5"` |
| `backend/src/services/aiUsage.ts:46` | — | ADAUGA `"claude-opus-5": { inputUsdPerMillion: 5, outputUsdPerMillion: 25 }` dupa `claude-opus-4-8`, care RAMANE |
| `backend/src/services/aiUsage.ts:78` | — | ADAUGA `"anthropic/claude-opus-5": { inputUsdPerMillion: 5, outputUsdPerMillion: 25 }` dupa `anthropic/claude-opus-4.8`, care RAMANE |

Comentariu in cod, in stilul vecinilor: la `ai.ts` in stilul celui de la `claude-sonnet` (cheia
interna ramane, se schimba doar modelId); la `aiUsage.ts` cu data verificarii pricingului.

**Verificare:** `npx tsc --noEmit -p backend/tsconfig.json`, plus testul existent de pricing lookup.
Confirma ca nicio intrare 4.8 nu a fost stearsa.

### Pas 2 — backend: mesajul judecatorului (include D3)

`backend/src/routes/ai.ts:282`, din:

```
"Model judecator nepermis. Doar Claude Opus 4.8, GPT-5.4 si Gemini 3.1 Pro."
```

in:

```
"Model judecator nepermis. Doar Claude Opus 5, GPT-5.6 Sol si Gemini 3.1 Pro."
```

Corectia `GPT-5.4` → `GPT-5.6 Sol` e intentionata si aprobata: `JUDGE_MODELS` contine `gpt-5.6-sol`,
iar copy-ul din frontend spune deja corect "GPT-5.6 Sol".

**Deja verificat:** string-ul NU e asertat in niciun test. `grep "judecator nepermis"` returneaza doar
`ai.ts:282` plus documente de plan. `backend/src/routes/ai.contract.test.ts:98` trimite
`judge: "claude-opus"`, adica cheia interna — neafectat.

### Pas 3 — frontend: labels, manual, export

| Fisier:linie | Din | In |
|---|---|---|
| `frontend/src/components/dosare-ai-config.ts:21` | label `"Opus 4.8"` | `"Opus 5"` |
| `frontend/src/components/dosare-ai-config.ts:47` | label `"Claude Opus 4.8"` | `"Claude Opus 5"` |
| `frontend/src/pages/manual-content.tsx:507` | `"Claude Opus 4.8 — Premium (cel mai detaliat)"` | `"Claude Opus 5 — Premium (cel mai detaliat)"` |
| `frontend/src/pages/manual-content.tsx:566` | `...premium: Claude Opus 4.8, GPT-5.6 Sol...` | `...premium: Claude Opus 5, GPT-5.6 Sol...` |
| `frontend/src/lib/export-manual.ts:348` | `Opus 4.8 (Premium)` | `Opus 5 (Premium)` |
| `frontend/src/lib/export-manual.ts:375` | `...premium: Claude Opus 4.8, GPT-5.6 Sol...` | `...premium: Claude Opus 5, GPT-5.6 Sol...` |

**Verificare:** `cd frontend && npx tsc --noEmit`.

### Pas 4 — teste

Obligatoriu, asserteaza direct valorile schimbate:

| Fisier:linie | Schimbare |
|---|---|
| `backend/src/services/ai.openrouter.test.ts:136` | slug asteptat → `"anthropic/claude-opus-5"` |
| `frontend/src/components/dosare-ai-config.test.ts:16` | titlu `it(...)`: "Opus 4.8" → "Opus 5" |
| `frontend/src/components/dosare-ai-config.test.ts:17` | label asteptat → `"Opus 5"` |
| `frontend/src/components/dosare-ai-config.test.ts:44` | titlu `it(...)`: "Opus 4.8" → "Opus 5" |
| `frontend/src/components/dosare-ai-config.test.ts:45` | label judecator asteptat → `"Claude Opus 5"` |

**NU atinge** `backend/src/services/aiUsage.test.ts:141,171` si
`backend/src/db/aiUsageRepository.test.ts:72`. Folosesc `anthropic/claude-opus-4.8` doar ca fixture,
iar intrarea de pricing 4.8 ramane in tabel conform D2, deci trec neschimbate. Daca pica, ceva din
Pasul 1 e gresit — investigheaza acolo, nu ajusta fixture-ul.

**Verificare:** `npm run test:backend` + `npm run test:frontend`.

### Pas 5 — documentatie

`DOCUMENTATIE.md:295` — randul din tabelul de modele devine:

```
| | Claude Opus 5 (Premium) | `claude-opus` | `claude-opus-5` |
```

`CHANGELOG.md` — sub headerul v2.43.2, adauga un paragraf nou dupa cele doua existente (Gemini
3.6 Flash si 3.5 Lite), in acelasi registru. Mentioneaza: slot Premium Anthropic, id nativ
`claude-opus-5` si slug `anthropic/claude-opus-5`, cheia interna `claude-opus` NEschimbata (deci
selectiile salvate raman valide, spre deosebire de refresh-urile Gemini), pricing identic 5/25 per
1M, plus corectia de copy din mesajul judecatorului.

`frontend/src/data/changelog-entries.tsx` — in entry-ul `version: "v2.43.2"`: extinde `subtitle` ca
sa acopere si Anthropic (azi vorbeste doar despre modelele Google) si adauga o sectiune noua in
`sections`, in stilul celor doua existente. Formuleaza pentru utilizator final, nu pentru dezvoltator.

Necesita restart Electron pentru `__APP_VERSION__` daca vrei sa vezi changelogul in app.

Extinderea unui entry v2.43.2 deja publicat e intentionata, nu o rescriere de istoric: e consecinta
directa a D4 (fara bump) si e exact ce a facut `87f5f94`, care a adaugat refresh-ul Gemini 3.5 Lite
sub acelasi header v2.43.2 dupa ce releaseul plecase.

## 5. Gate pre-push (non-negociabil, ordinea din CLAUDE.md)

1. `npx biome check --write` pe toate fisierele atinse
2. `npx tsc --noEmit -p backend/tsconfig.json` si `cd frontend && npx tsc --noEmit`
3. `npm run build`
4. `npm run test:backend` si `npm run test:frontend`

Alternativ `npm run check` ca one-shot, dar biome tot separat.

Inainte de commit, ruleaza si:

```
grep -riE "opus[ .-]?4[.-]8" .
```

Nu folosi `grep -i "opus 4.8"` — nu prinde nici `claude-opus-4-8`, nici `anthropic/claude-opus-4.8`,
adica exact identificatorii pe care ii schimbi. Dupa executie, singurele hituri admise sunt cele din
sectiunea 7.

## 6. Confirmare live (dupa merge, recomandat)

O analiza reala pe ruta **nativa**, apoi verifica in `ai_usage` un rand `claude-opus-5` cu cost nenul.

De ce doar nativ: pe ruta OpenRouter `costUsdMilli` vine direct din `usage.cost` al raspunsului
(`backend/src/services/ai.ts:698`), iar `directCostUsdMilli ?? estimateAiCostUsdMilli(...)`
(`backend/src/services/aiUsage.ts:182-189`) scurtcircuiteaza tabelul de preturi. Un smoke OpenRouter
NU valideaza intrarea `anthropic/claude-opus-5` din tabel; aceea ramane acoperita doar de testul de
lookup.

### Verificare operationala, in afara repo-ului

`OPENROUTER_MODEL_OVERRIDES` poate repina `claude-opus` pe orice slug fara rebuild. In repo e curat:
`.env.example:87` si `backend/.env.example:34` sunt goale, niciun deploy config committed nu pineaza
`claude-opus`. Dar mediul de productie nu e vizibil din repo. Inainte de a declara live-ul confirmat,
verifica env-ul de deploy: daca contine `claude-opus:...`, ori il scoti, ori il actualizezi pe
`anthropic/claude-opus-5`. Altfel refresh-ul e invizibil in productie.

## 7. Ce NU se atinge

Nu se ating `claude-haiku`, `claude-sonnet`, familia GPT sau Gemini. Nu se schimba `JUDGE_MODELS`,
politica de quota sau limitele de tokeni. Nu se sterge nicio intrare de pricing existenta.

Hituri de grep care raman legitim pe loc, sunt inregistrari istorice:

| Fisier | Ce e |
|---|---|
| `CHANGELOG.md` (entry-uri v2.38.0) | descriu corect ce s-a livrat atunci |
| `frontend/src/data/changelog-entries.tsx:279` | idem, changelog in-app v2.38.0 |
| `Legal-Dashboard-Prezentare.html:362` | artefact de prezentare, instantaneu al unui moment trecut |
| `Legal-Dashboard-v2.42.0-Fixuri-Post-Review.html` | idem |
| `PLAN-v2.38.0-hardening-model-refresh.md`, `PLAN-web-ux-*.md`, `HANDOFF-*.md`, `docs/superpowers/**` | planuri si handoff-uri istorice |
| `SESSION-HANDOFF.md`, `DOCUMENTATIE.md` (alte sectiuni decat L295) | verifica manual: doar randul din tabelul de modele se schimba |

Precedentul confirma alegerea pentru artefactele HTML: nici `87f5f94`, nici `c70ee44` nu le-au atins.

## 8. Capcane descoperite la review (nu le reintroduce)

Planul initial a trecut printr-un review adversarial Fable 5, iar fiecare finding a fost verificat in
cod. Patru lucruri sunt contraintuitive si merita retinute:

1. **`ai_usage.model` nu contine niciodata cheia interna.** `callModel`
   (`backend/src/services/ai.ts:826`) paseaza `model.modelId` (nativ) sau slug-ul (OpenRouter). Deci
   istoricul de consum se va imparti intre `claude-opus-4-8` si `claude-opus-5` indiferent ca pastram
   cheia `claude-opus`. E comportament asteptat, identic cu ce s-a intamplat la Sonnet, nu regresie.
2. **Un model id gresit NU produce warn de pricing.** Un 404 la provider inseamna 0 tokeni in si 0
   afara, deci `estimateAiCostUsdMilli` iese pe `return 0` la `aiUsage.ts:163` inainte sa verifice
   tabelul. Semnalul real de esec e `"action":"ai_call","status":"error"` in log, nu absenta pretului.
3. **Numele warn-ului de pret lipsa e `ai_usage.price_missing`** (`aiUsage.ts:151`), one-shot.
4. **Smoke-ul OpenRouter nu valideaza tabelul de preturi** — vezi sectiunea 6.

## 9. Definition of done

1. Cei cinci pasi aplicati, intr-un singur commit.
2. Gate-ul din sectiunea 5 verde, integral, rulat o data la final (nu dupa fiecare pas).
3. `grep -riE "opus[ .-]?4[.-]8"` returneaza doar hiturile din sectiunea 7.
4. Push pe branch-ul `feat/v2.43.0-rnpm-split`.
5. Optional, dupa deploy: confirmarea live din sectiunea 6, plus verificarea env-ului de productie.
