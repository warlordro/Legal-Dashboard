# PLAN — ICCJ: Filtre + Metrici (Tier 1 + Tier 2) + eliminarea limitei hardcodate de 50

Status: DRAFT pentru adversarial review (advisor + codex). Data: 2026-06-06.

## Obiectiv

Aducem la ICCJ filtrele si metricile pe care PortalJust le are deja (vezi poza 3:
Categorii, Stadii, Institutii, **Analiza Parte pe rol**), in masura in care sursa
permite. Plus: eliminam constanta hardcodata `ICCJ_PAGE_SIZE = 50` care ghiceste
dimensiunea paginii, si nu impunem niciun plafon artificial pe numarul de dosare
imbogatite (utilizatorul a respins explicit atat 50/pagina cat si un cap de 20-30).

## De ce e impartit pe niveluri (constrangere de sursa, nu de design)

PortalJust e API SOAP: un singur `CautareDosare` intoarce per dosar parti CU
`calitateParte`, `categorieCaz`, `stadiuProcesual`, sedinte — tot, pentru pana la
1000 dosare. De-aia metricile/Analiza Parte sunt gratis acolo: filtrare client-side
pe ce-a venit deja.

ICCJ nu are API; scrapuim HTML de pe scj.ro. Lista de cautare (/738, parsata de
`parseSearchItems`, [iccjClient.ts:209](backend/src/services/iccj/iccjClient.ts#L209))
da per dosar: `numar, iccjId, data(ISO), obiect, stadiuProcesual, departament(sectie),
parti(DOAR nume, calitateParte=""), categorieCaz=""`. Rolul partii si materia
juridica exista DOAR in pagina de detaliu (/1094, `fetchIccjDetail` →
[iccjClient.ts:354-373](backend/src/services/iccj/iccjClient.ts#L354)), un request
per dosar.

## Stare curenta verificata (cod)

- Backend `searchIccj` ([iccjClient.ts:505](backend/src/services/iccj/iccjClient.ts#L505))
  intoarce `{dosare, total, page, hasMore}`; `total = json.Keywords` (real, de la
  server); `hasMore = page * ICCJ_PAGE_SIZE(50) < total`
  ([iccjClient.ts:531](backend/src/services/iccj/iccjClient.ts#L531)). NU trimitem
  un parametru de page-size la scj.ro — 50 e o presupunere a noastra.
- Tipul frontend `Dosar` ARE deja `departament`, `categorieCaz`, `stadiuProcesual`,
  `parti`, `source`, `iccjId` ([types/index.ts:23-41](frontend/src/types/index.ts#L23)).
  Deci plumbing-ul de date exista; lipsesc doar valorile (categorie/rol) pana la enrich.
- `MetricsPanel` ([MetricsPanel.tsx](frontend/src/components/MetricsPanel.tsx))
  calculeaza TOTUL client-side din campurile `Dosar`: Categorii=`categorieCaz`,
  Stadii=`stadiuProcesual`, Institutii=`institutie`, Analiza Parte=`parti[].calitateParte`
  matchuit pe `searchedName`.
- Dosare.tsx gateaza pentru ICCJ: MetricsPanel ascuns (`!isIccj`,
  [Dosare.tsx:443](frontend/src/pages/Dosare.tsx#L443)); filtrele client-side
  bypass-ate (`dosare = isIccj ? state.allDosare : filterBy...`,
  [Dosare.tsx:155](frontend/src/pages/Dosare.tsx#L155)). Paginare ICCJ prin
  `handleIccjNextPage` (append + dedup pe iccjId), `iccjPaging={page,hasMore,total}`.
- SearchForm gateaza chips Categorie/Stadiu pe `source !== "iccj"`
  ([SearchForm.tsx:258,293](frontend/src/components/SearchForm.tsx#L258)); ICCJ are
  select Sectie (param server-side `Department`).
- Pattern SSE reutilizabil: `loadMoreSSE` ([api.ts:128](frontend/src/lib/api.ts#L128))
  cu evenimente `progress`/`batch`/`done`, `onProgress`/`onBatch`/`signal` (abort).
- Termene ICCJ (`searchTermeneByDosarIccj`,
  [iccjClient.ts:698](backend/src/services/iccj/iccjClient.ts#L698)) imbogateste pana
  la `MAX_TERMENE_DOSARE=20`, batch `TERMENE_DETAIL_CONCURRENCY=5`, foloseste `found.hasMore`.

## Workstream A — Eliminarea hardcodarii `ICCJ_PAGE_SIZE = 50`

Problema: `hasMore = page * 50 < total` presupune ca scj.ro da fix 50/pagina. Daca
difera, butonul "Incarca mai multe" apare/dispare gresit.

Solutie (exacta, fara numar magic): mutam decizia de `hasMore` pe **count cumulativ**,
pe care frontend-ul deja il are.

- Backend `searchIccj`: scoatem constanta `ICCJ_PAGE_SIZE` si campul derivat din ea.
  Returnam `{dosare, total, page}` (pastram `dosare.length` ca dimensiune reala a paginii).
  Pentru consumatorul intern (termene) calculam direct `truncated`/"mai sunt": pe
  pagina 1, `found.total > found.dosare.length`.
- `searchTermeneByDosarIccj`: inlocuim `found.hasMore` cu `found.total > found.dosare.length`
  (semantica corecta pe pagina 1). Comportamentul de termene ramane neschimbat in rest
  (cap 20 ramane — vezi nota de scope mai jos).
- Frontend: `hasMore = state.allDosare.length < total` (cumulativ, exact). Setam asta
  in `handleSearch` (initial: `res.data.length < res.total`) si in `handleIccjNextPage`
  (`merged.length < res.total`). Eliminam dependenta de `res.hasMore`.
- API/route: `/api/dosare-iccj` nu mai trimite `hasMore` (sau il pastram doar informativ);
  `api.dosare.searchIccj` ajusteaza tipul de retur.

Nota de scope: `MAX_TERMENE_DOSARE=20` din feature-ul de Termene e o limita DIFERITA
de cea de 50. Goal-ul vizeaza explicit "limita de 50". Lasam Termene neschimbat
(feature livrat si stabil) ca sa nu introducem regresii; il semnalez separat daca
userul vrea si acolo no-cap.

## Workstream B — Tier 1 (gratis, doar din lista; zero request-uri in plus)

Date disponibile imediat in lista ICCJ: `stadiuProcesual`, `departament` (sectie),
`numar/data/obiect`.

1. **MetricsPanel devine source-aware.** Adaugam prop `source: DosarSource` (sau
   `mode`). Pentru ICCJ:
   - Card "Institutii" → inlocuit cu **"Sectii"**, calculat din `d.departament`
     (la ICCJ `institutie` e mereu constanta → inutila; `departament` variaza).
   - Card "Stadii" → din `d.stadiuProcesual` (exista in lista). Functioneaza azi.
   - Card "Total Dosare" → trivial.
   - Card "Categorii" si "Analiza Parte" → randate doar dupa enrich (Tier 2). Pana
     atunci: placeholder discret + butonul de enrich (vezi Workstream C).
2. **Re-rutam ICCJ prin pipeline-ul de filtre client-side** pentru ce e disponibil:
   - Activam chips **Stadiu Procesual** si pentru ICCJ in SearchForm (azi gated pe
     `source !== "iccj"`). `filterByStadii` opereaza pe `stadiuProcesual` (prezent).
   - Chips Categorie raman ascunse pana la enrich (au nevoie de `categorieCaz`).
   - `Dosare.tsx:155`: NU mai bypass-am total pentru ICCJ. Rutam ICCJ prin
     `filterByStadii` (si dupa enrich prin `filterByCategorii` + `filterByRoles`).
     `filterByInstitutii` ramane bypass (enum SOAP irelevant la ICCJ).
   - **Verificare date**: `d.data` la ICCJ e ISO (din `iccjDateToIso`), deci
     `filterByDate` (compara stringuri ISO) ar trebui sa fie compatibil — CONFIRM la
     implementare cu un dosar real (comentariul de la
     [Dosare.tsx:145-147](frontend/src/pages/Dosare.tsx#L145) sugereaza altceva; il
     verific empiric inainte sa activez date-filter pe ICCJ).
3. **Sectie ca filtru client-side (optional)**: deja exista Sectie server-side in
   SearchForm. Adaugam doar **metrica** Sectii in Tier 1; filtru client-side pe sectie
   il consideram nice-to-have, nu blocant (server-side acopera cazul principal).

## Workstream C — Tier 2 (enrich prin detaliu; categorie + Analiza Parte pe rol)

Tinta: `categorieCaz` (Materia juridica) si `parti[].calitateParte` pentru TOATE
dosarele incarcate, fara plafon artificial. Enrich = un request /1094 per dosar.

Decizie de arhitectura (RECOMANDARE, de validat la adversarial review):

**Opt-in, streaming, abort-able, fara cap pe count.**
- Dupa o cautare ICCJ, Tier 1 apare instant. Un buton **"Incarca analiza detaliata
  (categorie + parti pe rol)"** porneste enrich-ul peste TOATE dosarele incarcate
  (`state.allDosare` care nu sunt deja enriched). Eticheta arata count-ul
  (ex. "...pentru 312 dosare") ca utilizatorul sa stie costul.
- Transport: **endpoint backend SSE nou** `POST /api/dosare-iccj/enrich`, body
  `{ iccjIds: string[] }`, reutilizand pattern-ul `loadMoreSSE` (`progress`/`batch`/`done`).
  Backend imbogateste in batch-uri cu concurrenta marginita (reutilizam
  `TERMENE_DETAIL_CONCURRENCY=5`), streameaza dosarele imbogatite pe masura ce sosesc,
  abort prin inchiderea conexiunii. Avantaj fata de varianta client-driven (N call-uri
  separate): control central de politete fata de scj.ro, un singur abort, overhead mic
  la sute de dosare. Limite de body deja existente (bulk 512KB) acopera lista de id-uri.
  - Validare input: fiecare `iccjId` trebuie `^\d{1,20}$` (acelasi guard ca ruta de
    detaliu, Codex #9). Cap dur de siguranta pe lungimea listei (ex. <= 2000) ca
    backstop anti-abuz, NU ca limita de produs.
- Frontend: la `onBatch`, fac merge SELECTIV in `allDosare` pe `iccjId`
  (`categorieCaz, stadiuProcesual, parti, sedinte` din detaliu; pastrez `numar/data/obiect`
  din lista). Marchez id-ul intr-un `Set<string> enrichedIds` din state. Progres + buton
  Stop (reutilizez UI-ul existent `loadMoreProgress`/`onStopLoadMore`).
- Dupa enrich, MetricsPanel recalculeaza reactiv Categorii + Analiza Parte; chips
  Categorie devin vizibile; `filterByCategorii`/`filterByRoles` se aplica si la ICCJ.

Alternativa considerata (client-driven, fara endpoint nou): frontend itereaza
`api.dosare.detaliuIccj(iccjId)` in batch-uri client-side de 5, merge la fiecare resolve.
Mai simpla (zero backend), dar N round-trip-uri client→backend si abort mai grosier.
O las ca fallback daca review-ul considera endpoint-ul SSE supradimensionat.

Mitigari de cost/politete (toate, indiferent de transport):
- Opt-in (nu auto pe fiecare cautare).
- Concurrenta marginita (5).
- Abort (Stop).
- Avertisment soft daca setul e mare (ex. > 100 dosare: "Va dura ~N secunde").
- `enrichedIds` previne re-enrich la re-click / paginare.

## Decizii deschise pentru adversarial review

1. Tier 2 **opt-in (recomandat) vs automat** dupa cautare? Auto = "ca PortalJust" dar
   loveste scj.ro la fiecare cautare ICCJ.
2. Enrich **endpoint SSE backend (recomandat) vs client-driven** pe endpoint-ul de
   detaliu existent?
3. La eliminarea celor 50: e suficient **`hasMore` cumulativ pe frontend**, sau vrem si
   sweep automat al tuturor paginilor inainte de enrich (risc: cautare cu mii de rezultate)?
4. Pastram `MAX_TERMENE_DOSARE=20` la Termene (scope separat) sau il scoatem si acolo?
5. Card "Institutii"→"Sectii" pentru ICCJ: corect conceptual, sau pastram si o numaratoare
   de institutie (mereu 1) pentru consistenta vizuala cu PortalJust?

## Riscuri

- **Incarcare pe scj.ro**: enrich fara cap = sute de request-uri. Mitigat prin opt-in +
  concurrenta + abort + avertisment.
- **Drift de markup** la detaliu (`fetchIccjDetail`): un dosar care nu se parseaza nu
  trebuie sa pice tot batch-ul — il marchez ca "neimbogatit" si continui (per-item
  try/catch in stream).
- **`filterByDate` pe ICCJ**: format de data — CONFIRM empiric inainte de activare.
- **Coerenta `searchedName`**: Analiza Parte depinde de `numeParte`; daca user cauta
  dupa numar/obiect, cardul Analiza Parte ramane gol (ca la PortalJust). OK.
- **Memorie/perf UI**: merge incremental in `allDosare` + recompute metrici la sute de
  dosare — `useMemo` deja prezent; verific ca recompute-ul nu blocheaza (batch updates).

## Verificare (criterii de succes)

- Backend: `npx tsc --noEmit -p backend/tsconfig.json`; `npm test --workspace=backend`
  (necesita switch ABI Node — vezi nota better-sqlite3); teste noi pentru: hasMore
  cumulativ corect (pagina partiala finala), enrich endpoint (ids valid/invalid, drift
  per-item).
- Frontend: `npx tsc --noEmit`; `npm test -- --run`; build curat. Teste pentru
  MetricsPanel source-aware (ICCJ: Sectii in loc de Institutii; Categorii/Parti goale
  pre-enrich).
- Biome `--write` pe toate fisierele atinse.
- Smoke live (Electron relansat): cautare ICCJ pe nume → Tier 1 instant (Stadii+Sectii);
  click enrich → progres → Categorii + Analiza Parte apar; Stop opreste; "Incarca mai
  multe" foloseste hasMore cumulativ corect.

## Findings verificate inainte de review (citire cod)

- **Formatul datei ICCJ = ISO**, NU DD.MM.YYYY. `iccjDateToIso`
  ([iccjClient.ts:188](backend/src/services/iccj/iccjClient.ts#L188)) converteste la
  YYYY-MM-DD, aplicat pe `data` in `parseSearchItems`
  ([iccjClient.ts:230](backend/src/services/iccj/iccjClient.ts#L230)). Input-urile de
  data sunt tot ISO. => `filterByDate` (comparatie string ISO) e SIGUR pe ICCJ.
  Comentariul de la [Dosare.tsx:145-147](frontend/src/pages/Dosare.tsx#L145) e STALE.
  Nota semantica: la ICCJ `d.data` e data formarii/coloana din lista, la PortalJust e
  data termenului — filtrul ramane corect tehnic, doar semantica difera.
- **`departament` e populat in lista ICCJ** (`parseSearchItems`,
  [iccjClient.ts:233](backend/src/services/iccj/iccjClient.ts#L233) `departament: stripTags(cells[5])`).
  => cardul "Sectii" (Tier 1) are date imediat.
- **Transport SSE confirmat**: `loadMoreSSE` ([api.ts:146-150](frontend/src/lib/api.ts#L146))
  e POST, query params + body JSON `{existing}`, stream `event:`/`data:`, abort prin
  `signal`. Enrich va fi POST `{iccjIds}` pe acelasi tipar (generalizez `loadMoreSSE`
  sa accepte un body arbitrar).
- **RISC NOU confirmat**: `fetchIccjDetail` NU reia sesiunea la raspuns invalid (spre
  deosebire de `searchIccj`, care reincearca o data cu cookie proaspat —
  [iccjClient.ts:513-527](backend/src/services/iccj/iccjClient.ts#L513)). La un enrich
  lung (sute de dosare > SESSION_TTL), cookie-ul poate expira la mijloc => detalii esuate.
  Fix necesar: enrich-ul trebuie sa faca refresh de sesiune si retry per-item la raspuns
  non-detaliu (sau sa imparta o sesiune proaspata garantata la pornire + refresh on-fail).

## Self-review interim (pre-external; advisor + codex erau down — outage clasificator)

Marcat INTERIM: cand revine infra, advisor + codex valideaza/contesta aceste concluzii.

Concluzii suplimentare din red-team propriu pe cod:
- **hasMore cumulativ — risc de buton blocat.** `total = json.Keywords` (server). Daca
  paginile se suprapun la granite si dedup-ul pe `iccjId` scoate randuri, `allDosare.length`
  nu atinge niciodata `total` => "Incarca mai multe" ramane vesnic. FIX: in `handleIccjNextPage`,
  `hasMore = res.data.length > 0 && addedNew > 0 && merged.length < total` (opreste si la
  zero randuri noi / pagina goala). Acopera si ultima pagina partiala.
- **Analiza Parte pre-enrich e inselatoare.** Lista ICCJ are parti trunchiate + pseudo-rand
  "Vezi mai multe parti" (vezi `iccjClient.test.ts`). Deci NU randam Analiza Parte din lista —
  doar dupa enrich (detaliul are parti complete + roluri). Consecvent cu gating-ul Tier 2.
- **Enrich trebuie sa SUPRASCRIE `parti` si `stadiuProcesual` din lista cu cele din detaliu**
  (detaliul e autoritativ + complet), dar sa pastreze `numar/data/obiect` din lista.

Raspunsuri interimare la "Decizii deschise":
1. Tier 2 **opt-in** (nu automat). Auto = lovim scj.ro la fiecare cautare; opt-in respecta
   "no cap" (imbogateste tot ce e incarcat la click) fara hammering implicit.
2. **Endpoint SSE backend** (nu client-driven). Concurenta/politete centralizata, un singur
   abort, o conexiune, si permite refresh de sesiune centralizat (gap-ul `fetchIccjDetail`).
3. **hasMore cumulativ, FARA auto-sweep** de pagini. Sweep-ul automat al miilor de rezultate
   inainte de enrich e exact cazul abuziv. Paginare la cerere + enrich opt-in pe setul incarcat.
4. **Pastram `MAX_TERMENE_DOSARE=20`** la Termene (scope separat; eliminarea ar cere sweep si
   acolo). De semnalat userului ca decizie separata.
5. **Da, Institutii→Sectii pentru ICCJ** (`departament`). Institutie e constanta (=1) => inutila;
   sectia variaza. PortalJust ramane cu "Institutii" neschimbat (MetricsPanel source-aware).

Politete scj.ro (interim, de confirmat la review): concurenta 5 poate fi prea agresiva pentru
un site guvernamental fragil; iau in calcul **concurenta 3** + un mic delay intre batch-uri, si
**prag de confirmare la > ~100 dosare** ("Asta va face N cereri catre scj.ro, dureaza ~X s").

## PIVOT FINAL (cerinta user) — enrich 100% SERVER-SIDE, fara UI in frontend

Userul a cerut explicit: "nu vreau sa mai vad autoloaderul in frontend, se va face doar
in backend". Deci enrich-ul client-driven (buton/progres/Stop/auto-effect) a fost ELIMINAT
complet din frontend. In loc:

- Ruta `/api/dosare-iccj` foloseste `searchIccjEnriched` (iccjClient.ts): dupa `searchIccj`
  (lista), imbogateste fiecare dosar din pagina via `fetchIccjDetail` (concurenta 5, per-item
  isolation) si raspunde cu dosare COMPLETE (categorie + roluri + sedinte) intr-un singur apel.
- Frontend: zero logica/UI de enrich. Cautarea intoarce date complete; MetricsPanel (source-aware)
  arata Categorii + Analiza Parte imediat, facets dinamice se populeaza, totul sub spinner-ul
  normal de cautare.
- Latenta masurata live: cautare specifica (1 dosar) 0.4s; cautare larga (50 dosare) 1.8s —
  neglijabil, deci nu e nevoie de niciun loader separat.
- NU se atinge `searchIccj` direct (monitoring + termene il folosesc fara enrich); enrich-ul e
  doar in ruta de cautare dosare.

Sectiunile de mai jos (client-driven) sunt ISTORIC — superseded de acest pivot.

## REVIZUIRE POST-REVIEW (multi-agent, 4 lens-uri) — DESIGN FINAL

Verdict consensual: minor-changes (directie corecta). Modificarile de mai jos
SUPERSEDA deciziile deschise + recomandarile anterioare de transport.

### Decizii finale
1. **Transport Tier 2 = CLIENT-DRIVEN** (batched `api.dosare.detaliuIccj`), NU endpoint
   SSE backend. Motiv: abort fail-safe garantat (AbortController per fetch), zero blast
   radius pe `loadMoreSSE`, iar avantajul de "refresh sesiune centralizat" dispare cand
   `fetchIccjDetail` capata refresh propriu. NU se atinge `loadMoreSSE`.
2. **Enrich = opt-in**, buton "Incarca analiza detaliata (N dosare)"; confirm peste ~100.
3. **`hasMore` scos din shape.** Frontend calculeaza cumulativ:
   `hasMore = res.data.length > 0 && addedNew > 0 && merged.length < total`
   (acopera ultima pagina partiala + stall din dedup). Termene:
   `truncated = found.dosare.length > MAX_TERMENE_DOSARE || found.total > found.dosare.length`.
   Atomic: interface `IccjSearchResult` + ruta + `api.ts` + `Dosare.tsx` + termene intr-un commit.
   Monitoring (`index.ts:671`) citeste doar `res.dosare` → neafectat.
4. **`MAX_TERMENE_DOSARE=20` ramane** (scope separat; de semnalat userului).
5. Card metrica ICCJ pre-enrich = **"Departament"** (cells[5] = nume complet, nu sectie
   curata), NU "Sectii".

### Backend (low-risk, foundational)
- **A. hasMore**: scot `ICCJ_PAGE_SIZE`; aplic schema cumulativa de mai sus.
- **B. session-refresh DIRECT in `fetchIccjDetail`**: one-shot retry pe `IccjSourceError`
  (NU `IccjParseError` — altfel mascheaza markup drift), cu **single-flight warmSession**
  (un singur Promise<string> partajat, ca 5 fetch-uri concurente sa nu faca 5 warm-up GET).
  Beneficiaza enrich + monitoring `iccjRunner` + row-expand `DosareTable`.
- **C. batch isolation in `searchTermeneByDosarIccj`** (bug latent productie): per-item
  try/catch (continui pe esec, marchez warning), in loc de `Promise.all` gol.

### Frontend Tier 1
- **MetricsPanel source-aware** — prop `source`. 3 suprafete: `SummaryCard` (label
  "Institutii"→"Departament" pentru ICCJ, calcul din `d.departament`), `InstitutiiChart`,
  si `formatInstitutieShort` (skip prefixele de instanta pentru ICCJ). Categorii +
  Analiza Parte ASCUNSE pre-enrich (calitateParte gol → fara roluri; categorieCaz gol).
  PortalJust: cai de cod byte-identice (test pe dataset PortalJust).
- **Rutez ICCJ prin filtre client-side**: scot bypass-ul `isIccj ? state.allDosare`
  ([Dosare.tsx:155](frontend/src/pages/Dosare.tsx#L155)) → rulez `filterByDate` + `filterByStadii`
  (+ post-enrich `filterByCategorii`/`filterByRoles`); `filterByInstitutii` ramane bypass.
  Opresc reset-ul `stadii:[]` din ramura ICCJ ([Dosare.tsx:176-177](frontend/src/pages/Dosare.tsx#L176)).
- **Chips Stadiu/Categorie DINAMICE pentru ICCJ** din result set (NU array static `STADII`
  care e PortalJust-only). PortalJust pastreaza chips statice.
- **Disclaimer coverage**: cand `source=iccj && allDosare.length < total` → "Metrici pentru
  N din M dosare incarcate".
- **MetricsPanel primeste acelasi array filtrat** ca `DosareTable` (sa nu divergheze).
- Sterg comentariul stale [Dosare.tsx:145-147](frontend/src/pages/Dosare.tsx#L145); `filterByDate` e sigur (data ISO).
- ~~Pasez `sectiiCount` real in `onSearchComplete` meta; buildLabel adauga sufix " (ICCJ)".~~
  DECIS (post-implementare): NU se face. `meta {categoriesCount:0, institutiiCount:1}` e
  deja CORECT pentru ICCJ pre-enrich (0 categorii pana la enrich; ICCJ = o institutie), iar
  cardul Dashboard are etichete fixe "Categorii"/"Institutii" — a-l face source-aware ar fi
  refactor de Dashboard, out of scope. buildLabel: sursa e deja distinsa de badge-ul ICCJ/PJ
  din sidebar (reparat in aceasta sesiune), deci sufixul ar fi redundant.
- DONE (post-review advisor): la enrich PARTIAL, Categorii se calculeaza doar peste randurile
  cu `categorieCaz` ne-gol (altfel randurile ne-enriched ar cadea in "Altele" si ar amesteca
  "ne-enriched" cu "alta categorie").

### Frontend Tier 2 (client-driven enrich)
- Buton opt-in; concurenta **3** (nu 5) + delay mic inter-batch; AbortController (Stop).
- Merge canonic pe `iccjId`: din detaliu {categorieCaz, stadiuProcesual, parti, sedinte,
  +optional}; din lista {numar, data, obiect, iccjId, institutie, departament}.
- `enrichedIds: Set` — esecurile NU intra (re-click reincearca doar esecurile).
- `detaliuIccj` capata suport `AbortSignal` (per-fetch abort).
- Validare `^\d{1,20}$` deja in ruta detaliu; pastrez.

### Bug-uri existente prinse de review (in scope ICCJ)
- **Export PDF** ([export-dosare.ts:74-76](frontend/src/lib/export-dosare.ts#L74)) ruteaza ICCJ → portal.just.ro:
  `getDosarExternalUrl(d)`; guard `formatPartiPDF` pe `calitateParte` gol.
- **Export XLSX backend** (`dosareExportXlsx.ts:191`): guard `calitateParte` gol;
  titlu sheet source-aware.

### Teste
- Backend: hasMore=false la 0 randuri noi / ultima pagina partiala; termene `truncated`
  pe `total > dosare.length`; session-refresh expired→recover; batch isolation (un item pica).
- Frontend: MetricsPanel source-aware (card "Departament" nu "Institutii"; Categorii absent
  pre-enrich); enrichedIds previne re-enrich; filtru stadiu ingusteaza set ICCJ.

## Ordine de implementare

1. Workstream A (hasMore cumulativ) — mic, izolat, deblocheaza paginarea corecta.
2. Workstream B (MetricsPanel source-aware + ungate Tier 1 + chips Stadiu ICCJ).
3. Workstream C backend (endpoint enrich SSE) → frontend (buton + merge + progres).
4. Teste + biome + build + smoke live.
5. Daca se decide release: bump versiune + docs conform checklist CLAUDE.md.
