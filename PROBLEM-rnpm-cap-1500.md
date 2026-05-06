# Problema: Cap RNPM 1500 inscrieri — gap fundamental pe debitori cu volum mare

**Data raport**: 2026-05-07
**Versiune curenta**: v2.18.0
**Stadiu**: nerezolvabil pe API public RNPM. Documentat ca limitare cunoscuta.

## Cazul empiric

CUI debitor: `33317138` (PJ)
Categorie: `specifice` (Avize specifice)
Filtre default: `activ:true`, `nemodificat:true`, `parteJ.CUI:33317138`

| Layer | Filtru aplicat | Total RNPM | Comportament |
|---|---|---|---|
| Parent (raw) | parteJ.CUI | 1825 | RNPM oficial: "modificati criteriile sa scada sub 1500" |
| Tier-1 (v2.17.0) | + `tipInscriere=1` (aviz initial) | 1822 | Tot peste cap |
| Tier-2 (v2.18.0) | + `destinatieInscriere=5` (cesiune creanta) | **1744** | Tot peste cap |
| Tier-2 alte destinatii | 1-4, 6-12, 14 | 0 | Goale |
| Tier-2 destinatie 13 | titluri executorii sub semnatura privata | 76 | Recuperat integral |

**Recuperare reala pentru sub-tip "aviz initial"**: 76 din 1822 (~4%).
**Gap**: ~1744 records pe destinatie 5, neaccesibile via API public.

## Dovada cap-ul e RNPM, nu al nostru

Captura din site-ul oficial mj.rnpm.ro pentru aceeasi cautare:

> *"Pentru a obtine o lista de inscrieri care pot fi vizualizate, modificati criteriile de cautare astfel incat sa se obtina mai putin de 1500 de rezultate."*
>
> S-au gasit **1825 inscrieri**.

Confirmare empirica anterioara (2026-05-06, cod-comentariu in [rnpmSearchService.ts:55](backend/src/services/rnpmSearchService.ts#L55)): la query cu total > 1500, RNPM intoarce HTTP 200 dar `documents: []` pe toate paginile — refuz silentios.

## Axe de split incercate

| Axa | Status | Observatie |
|---|---|---|
| `tipInscriere` | ✅ implementat (v2.17.0 tier-1) | 7 sub-tipuri pentru `specifice`, 18 pentru `ipoteci` |
| `destinatieInscriere` | ✅ implementat (v2.18.0 tier-2) | 14 destinatii pentru `specifice`, 10 pentru `ipoteci`. `creante`/`obligatiuni`/`fiducii` nu au lista enumerable |
| `perioadaStart`/`perioadaFinal` | ❌ ineficient | Confirmat empiric anterior — split-ul temporal nu reduce total cand records sunt clusterate |
| `activ` (true/false) | ❌ neutil | RNPM trateaza `activ:true` si `activ:false` identical (ambele = active only); doar omiterea field-ului returneaza mixt (commit `0c0c605` 2026-04-18) |
| `nemodificat` (true/false) | ❌ neexplorat sistematic | Posibil candidat tier-3, dar empiric pe acest CUI cele 1744 sunt toate `nemodificat:true`, deci toggle pe `false` ar da ~0 |
| `tipAct` | ❌ neutil | Identifica un act anume, nu filtreaza colectie |
| `nrAct`, `dataAct` | ❌ neutil | Identificator unic, nu filtru |
| `creditorPJ.CUI` | ❌ nepractic | Lista creditorilor unui debitor nu e cunoscuta in avans; ar necesita N cautari per creditor cu N necunoscut |

## Encoding-uri verificate empiric (2026-05-07)

`tipInscriere.value` si `destinatieInscriere.value` ambele sunt **index 1-based** in lista oficiala (1, 2, ..., len). Trimiterea label-ului literal returneaza `total: 0`. Constatat la `executeNestedDestinationSplit` cand toate cele 14 destinatii returnau 0 desi tier-1 sub-tip avea 1822 records — fix-ul: `String(j + 1)` in loc de label.

## Optiuni out-of-the-box considerate si respinse

1. **Pagination peste cap** — cap-ul e enforcement RNPM, nu client-side. Pages 61-70 returneaza `documents: []`. Respins.
2. **Sort order opus** — RNPM nu expune sort direction in API; cap-ul probabil aplica acelasi top-1500 indiferent. Netestabil fara reverse engineering.
3. **Combinatie `activ` × `nemodificat`** (4 cohorte) — `activ` toggle nu produce buckete distincte; ramane doar `nemodificat`, max ~2x split, nesuficient pentru 1744 records.
4. **Bisectie binara temporala automata** — discutat ca tier-3 algoritmic; respins pentru ca user a stabilit ca data nu ajuta empiric pe RNPM.
5. **Probe identificator** — UUID-urile nu sunt secventiale/predictibile; nu putem enumera.
6. **Cerere oficiala RNPM pentru export** — calea legala extrinseca, in afara scope-ului aplicatiei.

## Concluzia tehnica

Pe debitori cu **>1500 inscrieri intr-o singura combinatie de tier-1 × tier-2**, recuperarea integrala via API public RNPM e **imposibila**. Site-ul oficial cere explicit utilizatorului sa restranga criteriile, dar nu ofera axa de split alternativa cand toate filtrele dimensionale au fost epuizate.

v2.18.0 cu best-effort + disclosure UI (banner amber + gap calculat la runtime) e raspunsul corect arhitectural: recuperam ce putem, raportam onest ce nu.

## Implicatii pentru viitor

- **Categoriile `creante` / `obligatiuni` / `fiducii`** raman fara tier-2 — nu au destinatii enumerable. Pentru ele, daca tier-1 sub-tip > 1500 → fail-clean, fara recuperare. Daca apare empiric un caz dens pe aceste categorii, nu exista solutie din UI.
- **Plafonul real al aplicatiei**: oricat de bine implementam split-uri, exista debitori "intr-adevar mari" (Bancile mari, ANAF, fonduri) ale caror inscrieri agregate depasesc cuvântul de cautare orice combinatie. Gap-ul scaleaza cu volumul real al debitorului.
- **Daca RNPM lanseaza vreodata** filtru aditional in UI oficial (ex. an/luna explicit, county filter) — atunci tier-3 devine viabil. Pana atunci, design-ul nu poate progresa.

## Referinte

- Cod: [backend/src/services/rnpmSearchService.ts](backend/src/services/rnpmSearchService.ts) (executeSplitSearch, executeNestedDestinationSplit)
- Cod: [backend/src/services/rnpmDestinations.ts](backend/src/services/rnpmDestinations.ts) (DESTINATII_BY_CATEGORY)
- Site oficial: https://www.rnpm.ro / https://mj.rnpm.ro
- Cap-ul declarat in cod: `MAX_TOTAL_RESULTS = 1500` ([rnpmSearchService.ts:60](backend/src/services/rnpmSearchService.ts#L60))
