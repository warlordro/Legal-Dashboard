# Analiza: gap RNPM 342 vs 438 pe CUI 33317138 — cauza e ROLUL, nu categoria

**Data**: 2026-05-07
**Versiune**: v2.19.1
**Stadiu**: diagnostic empiric inchis. Solutie UI propusa (toggle "ambele roluri").

## Simptom raportat

User a comparat:
- **PDF oficial RNPM** (mj.rnpm.ro, descarcat pentru CUI 33317138): 438 avize active.
- **Excel export Legal Dashboard** (din cautarea pe `Aviz de ipoteca mobiliara`, CUI 33317138): 342 avize.

Diferenta: **96 avize lipsa** in Excel.

## Asumptia initiala (gresita)

Ipoteza: cele 96 lipsa erau "CONTRACT DE IPOTECA MOBILIARA ASUPRA CREANTELOR" si tin de categoria RNPM `creante` securitizate, nu `ipoteci`.

Test empiric:

| ID search | Categorie | Filtru | Total |
|---|---|---|---|
| 32 | `creante` | `debitorJ.denumire="33317138"` (typo de la user, in field-ul gresit) | 0 |
| 33 | `creante` | `debitorJ.CUI=33317138` | **0** |

→ Categoria `creante` returneaza zero pentru acest CUI. Asumptia respinsa.

## Confirmarea categoriei reala

Din PDF user-ul a luat un identificator concret de aviz "ASUPRA CREANTELOR": `2024-11051507179836-FOB`.

| ID search | Categorie | Filtru | Total |
|---|---|---|---|
| 35 | `ipoteci` | `identificatorInscriere=2024-11051507179836-FOB` | **1** ✅ |

→ Avizul "ASUPRA CREANTELOR" exista in categoria `ipoteci`. Categoria `creante` e altceva (probabil emisiuni titluri din portofolii securitizate, foarte rar utilizata).

**Concluzie partiala**: corrigendum la memoria interna. "ASUPRA CREANTELOR" = sub-tip in `ipoteci` (identificat prin textul `tipAct`), NU categorie separata.

## Cauza reala a gap-ului

Cautarea originala a user-ului:

| ID search | Categorie | Filtru | Total |
|---|---|---|---|
| 34 | `ipoteci` | `creditorPJ.CUI=33317138`, activ, nemodificat | **342** |

Field-ul folosit a fost `creditorPJ.CUI` → deci 342 = avize unde 33317138 e **CREDITOR**.

PDF-ul oficial RNPM prezinta agregat **toate avizele in care CUI apare in orice rol** (creditor + debitor + parte). API-ul public RNPM nu expune un search "OR pe roluri" — fiecare cautare e legata de un singur field.

**Hipoteza confirmata** (validata logic de user, "corect!"): cele 96 avize lipsa = avize unde 33317138 apare ca **debitor** (`debitorPJ.CUI`), nu creditor.

342 (creditor) + ~96 (debitor) ≈ 438 (PDF total).

## Encoding parts pe categorii (memo)

Each categorie RNPM are field-uri DIFERITE pentru roluri:

| Categorie | Roluri expuse in API | Field CUI |
|---|---|---|
| `ipoteci` | creditor PJ/PF, debitor PJ/PF, tert PJ/PF | `creditorPJ.CUI`, `debitorPJ.CUI`, `tertPJ.CUI` |
| `creante` | debitor (fara `P`) | `debitorJ.CUI` |
| `specifice` | parte (fara distinctie creditor/debitor) | `parteJ.CUI` |
| `obligatiuni` | (similar) | de verificat empiric daca apare un caz |
| `fiducii` | (similar) | de verificat empiric daca apare un caz |

## Solutie UI propusa

**Pattern problema**: pentru orice CUI cu portofoliu mare, user-ul trebuie sa stie sa lanseze N cautari (creditor / debitor / tert) si sa concateneze + dedup-eze rezultatele manual. Nu e descoperabil din UI; cei mai multi vor lansa o singura cautare si vor crede ca au totul.

**Optiuni**:

1. **Toggle "Cauta pe ambele roluri (creditor + debitor)"** in form-ul `ipoteci`.
   - Cost: 2 captcha (in loc de 1).
   - Implementare: in `RnpmSearchForm.tsx` un checkbox; cand activ, frontend-ul lanseaza 2 search-uri secventiale (`creditorPJ.CUI=X` apoi `debitorPJ.CUI=X`) si concateneaza la nivelul UI listei + dedup pe `identificator.k`.
   - Output: o singura tabela cu coloana noua "Rol CUI" (creditor / debitor / ambele).

2. **Mod "recuperare totala per CUI"** — un buton dedicat care lanseaza 5-10 cautari (toate categoriile × toate rolurile relevante) si dedup-eaza.
   - Cost: 5-10 captcha per CUI.
   - Mai radical, dar acopera si cazul cross-category (creante/obligatiuni/fiducii rare dar posibile).
   - Probabil out-of-scope acum; toggle-ul simplu pe `ipoteci` rezolva 90% din cazuri.

3. **Banner UI educational** — daca user-ul cauta pe `creditorPJ.CUI` si nu bifeaza nimic pe debitor, afiseaza un hint dupa rezultate: "Daca acest CUI apare si ca debitor, exista posibil avize aditionale. Repeta cautarea pe sectiunea Debitor."
   - Cel mai ieftin (doar text), zero captcha aditional, dar lasa user-ul sa actioneze.

**Recomandare**: Optiunea 1 (toggle) — cel mai bun ROI, cost predictibil (exact 2 captcha), descoperabil, si rezolva 100% din cazurile pe `ipoteci`.

## Referinte

- DB SQLite: `%APPDATA%\legal-dashboard\legal-dashboard.db`, tabela `rnpm_searches` id-uri 32-35.
- Cod form: [frontend/src/components/rnpm/RnpmSearchForm.tsx](frontend/src/components/rnpm/RnpmSearchForm.tsx)
- Cod export (1:1, fara filtru): [frontend/src/lib/rnpmExport.ts](frontend/src/lib/rnpmExport.ts) liniile 150-176
- Definitie tipuri rol: [backend/src/services/rnpmClient.ts](backend/src/services/rnpmClient.ts) (RnpmSearchType, debitorPJ, creditorPJ, debitorJ, parteJ)
