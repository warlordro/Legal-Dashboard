# PLAN — Integrare cautare ICCJ (Inalta Curte de Casatie si Justitie)

Status: DRAFT spec (brainstorming) — build conditionat de Phase 0.
Data: 2026-06-06.
Decizii user: scope = ambele (search interactiv + monitoring); UI = selector de sursa pe pagina Dosare; arhitectura = LIVE-PROXY (oglindeste modulul SOAP existent), NU corpus local. ATAT search CAT SI monitoring sunt live (per job + snapshot diff); fara arhiva/corpus NICAIERI.

---

## 1. Concluzia de fezabilitate (verificat empiric, nu din memorie)

### 1.1 ICCJ NU e acoperit de portalquery.just.ro
Probe live (2026-06-06, prin SOAP-ul folosit de app):
dosar ICCJ-origine `2831/1/2019` -> 0 rezultate; `2310/1/2000` -> 0 rezultate; cautare larga "BANCA TRANSILVANIA SA" -> 1000 dosare reale, NICIUNUL cu instanta "Inalta Curte". Lista WSDL din `frontend/src/lib/institutii.ts` (246 instante) nu contine ICCJ.
Concluzie: la nivel de INREGISTRARE, zero suprapunere — ICCJ ar fi continut 100% nou.
Nuanta (corectie de model): un dosar la ICCJ pe recurs PASTREAZA numarul instantei de origine (ex. `6945/306/2015`), deci ACELASI numar de dosar poate exista in portalquery (faza inferioara) SI la ICCJ (recurs). numar NU e cheie globala. Cu selector de sursa asta e ok (sunt stadii diferite).

### 1.2 ICCJ — trei vectori de acces reali

| Vector | Format | Fereastra orara | Transport | Confirmat 2026-06-06 |
|---|---|---|---|---|
| A. Search live website `/738` | JSON envelope cu `Items` = string HTML (scraping) | NICIUNA | HTTPS (www.scj.ro) | DA — POPESCU = 136 rezultate, in plina zi |
| B. Serviciu web `api.scj.ro:97` (doc 2019) | JSON curat | 3:30-6:30 AM | HTTP | NU — timeout pe port 97 |
| C. Arhiva zilnica JSON (doc 2019) | JSON curat | niciuna (fisier static) | ? | NU — URL negasit |

### 1.3 Vectorul ales: A (live-proxy)
Pentru ca Vector A merge ziua, search-ul interactiv NU are nevoie de corpus local — proxeaza live (ca modulul SOAP). Monitoringul urmareste doar tinte specifice, deci ruleaza cautari live programate + snapshot diff (ca `dosarSoapRunner`). Asta elimina: corpusul partajat, violarea invariantului `owner_id`, URL-ul necunoscut al arhivei, fereastra orara.

Verdict: fezabil, fit arhitectural foarte bun (pattern existent, fara captcha). Phase 0 mult mai mic decat la varianta corpus.

### 1.4 ATENTIE — tensiune de intentie (de evaluat la review)
Doc-ul ICCJ 2019 (DESCRIERE GENERALA) spune textual ca serviciul web `api.scj.ro:97` a fost creat "in vederea degrevarii site-ului web al ICCJ de aplicatiile automate (crawlere)". Deci canalul SANCTIONAT pentru acces programatic e Vector B/C, nu scraping pe website (Vector A).
Interpretare propusa: scraping pe `/738` e acceptabil pentru search INTERACTIV (initiat de user, volum mic = echivalent cu un om care foloseste site-ul), dar pentru MONITORING AUTOMAT (polling programat, posibil multe joburi) e exact comportamentul de crawler pe care ICCJ a vrut sa-l mute pe web service.
Decizie user (post-review Codex, 2026-06-06): monitoringul ramane TOT live, FULL (numar + nume), in v1, FARA gate/ack/deferral. Riscul de abuz/intentie semnalat de Codex (#1) e ACCEPTAT explicit de owner ("ignora chestia cu abuz, vom vedea live"). Se pastreaza doar masuri de FIABILITATE (nu de gating): per-host queue concurrency 1 pe www.scj.ro ca sa nu ne dam singuri jos search-ul interactiv printr-un IP ban, + `MONITORING_DISABLED_KINDS=iccj` ca kill switch existent. Cifre exacte de rate: se ajusteaza observand live. Vezi sectiunea 15 pentru dispozitia completa a review-ului.

---

## 2. Arhitectura — live-proxy (oglindeste `backend/src/soap.ts`)

Flux search interactiv:
user (Dosare, sursa=ICCJ) -> `GET /api/dosare?source=iccj&...` -> `iccj.ts:cautareDosareIccj()` -> www.scj.ro (POST /738 + cookie sesiune) -> parse HTML rows -> intoarce `Dosar[]` -> `DosareTable`. Detaliile complete (termene/parti-calitate/cai atac) se aduc lazy la expandare rand (un fetch `/1094/Detalii-dosar?...id`).

Flux monitoring:
scheduler tick -> claim job kind=`iccj` -> `iccjRunner.run()` -> `cautareDosareIccj()` (+ fetch detaliu) pentru tinta -> build snapshot -> diff vs ultimul snapshot (owner-scoped) -> alerte. ZERO corpus global. Snapshot-urile raman in `monitoring_snapshots` (owner_id-scoped — fara violare de invariant).

Nimic nou in modelul de date global. Singura tabela atinsa: `monitoring_jobs.kind` primeste valoarea `iccj`.

---

## 3. Modulul `backend/src/iccj.ts` (mirror al `soap.ts`)

Functii:
- `cautareDosareIccj(params: IccjSearchParams, options?: { signal?: AbortSignal }): Promise<Dosar[]>`
- `fetchDetaliuDosarIccj(id: string, options?): Promise<DosarDetaliu>` — pagina `/1094/Detalii-dosar`
- helpers de parse HTML (rows + detaliu), defensiv

Detalii tehnice confirmate empiric (2026-06-06):
- Search: `POST https://www.scj.ro/738/C%C4%83utare%20dosare%20%C5%9Fi%20p%C4%83r%C5%A3i`
  Headers: `Content-Type: application/x-www-form-urlencoded`, `X-Requested-With: XMLHttpRequest`, `Referer: .../738/Cautare-dosare-si-parti`, cookie de sesiune.
  Body (form-urlencoded): `formTypeId=6`, `websiteId=0`, plus 6 perechi `CustomQuery[i].Key` / `CustomQuery[i].Value`:
  - [0] DocketObject  = obiect
  - [1] Department    = id sectie (vezi 4.3)
  - [2] DocketNumber  = numar dosar
  - [3] PartyName     = nume parte
  - [4] StartDate     = data formare >=
  - [5] EndDate       = data formare <=
- Cookie de sesiune OBLIGATORIU: fara el raspunsul e `{"Keywords":"Nu sunt rezultate.","Items":null,"Status":1}` (FALS gol). Flow: GET `/738/Cautare-dosare-si-parti` -> jar cookie -> POST. Cookie-ul se cache-uieste cu TTL + refresh la expirare/anomalie.
- Raspuns: `{ "Keywords":"N rezultate", "ExtraData":{...}, "Items":"<tr>...HTML...</tr>", "Pager":"<ol class=...>...</ol>", "Status":1, "Message":"" }`.
  `Items` e string HTML (escaped <). Fiecare `<tr>` are coloanele: index, `<a href="/1094/Detalii-dosar?...Value=<ID_INTERN>">NUMAR</a>`, data (DD.MM.YYYY), obiect, stadiu, sectie/complet, `<ul><li>parte</li>...</ul>`.
- Detaliu: `GET https://www.scj.ro/1094/Detalii-dosar?customQuery%5B0%5D.Key=id&customQuery%5B0%5D.Value=<ID_INTERN>` (cu cookie). Pagina HTML completa: Numarul dosarului, Numarul vechi, Data formarii la ICCJ, ... + termene, parti cu calitate, cai de atac, optiune "Descarca PDF". ID_INTERN vine din linkul din lista (ex. 100000000360872).
- Timeout intern + `AbortSignal.any([external, timeout])` (copiaza pattern-ul `combineSignals` din soap.ts). Cap pe marimea raspunsului (ca `SOAP_MAX_RESPONSE_BYTES`).

Reguli de cautare (din doc + comportament site, verificat): minim un filtru; minim 3 caractere; case + accent insensitive; max 1000 rezultate; paginare via Pager.
Sortare default = DATA DESCRESCATOR (cele mai noi prima): pagina 1 a unei cautari fara interval arata doar anul curent, dar ISTORICUL E ACOPERIT (verificat: POPESCU restrans la 2016-2019 -> dosare din 2019). => pentru un set complet, app-ul trebuie sa pagineze prin Pager pana la epuizare (cap 1000), nu sa se opreasca la pagina 1. Verificat empiric: DocketNumber (`1085/1/2026` -> 1 rezultat), PartyName, interval de data, si istoric — toate functioneaza.

GUARD CRITIC (clasificator empty-real vs empty-fals — Codex #3, ACCEPTAT):
Tipuri explicite `IccjSourceError` + `IccjParseError`; runnerul NU primeste NICIODATA `[]` pentru fail de sesiune/markup.
"True empty" (chiar 0 rezultate) acceptat DOAR cand TOATE: sesiunea a fost obtinuta/validata in aceeasi incercare; `Status === 1`; `Items === null`; `Keywords` are forma "Nu sunt rezultate." (nu markup de redirect/anti-bot/eroare). Altfel -> `IccjSourceError`.
La `Items:null` dupa un query care anterior avea rezultate (sau cookie tocmai refresh-uit) -> retry O SINGURA data cu GET fresh + POST inainte de a concluziona empty.
Monitoring: NU persista snapshot cand clasificarea e ambigua (altfel baseline corupt -> `dosar_new`/`dosar_disappeared` false la rularile urmatoare). source_error pentru ICCJ se emite la PRIMUL esec ambiguu (log structured + alert intern), NU la pragul generic de 5 din scheduler (`scheduler.ts:43,592`) — fals-golul ICCJ nu e un transient SOAP obisnuit.

---

## 4. Filtre verificate pe site (oglindite in frontend)

Verificat live (2026-06-06) pe formularele randate JS.

### 4.1 Cautare dosare si parti (`/738`)
| Camp pe site | Tip | Mapare |
|---|---|---|
| Numarul dosarului | text | DocketNumber (match) |
| Sectie | dropdown (11 optiuni) | Department (id) |
| Nume parte | text | PartyName (LIKE multi-cuvant AND) |
| Obiectul dosarului | text | DocketObject (LIKE multi-cuvant AND) |
| Data formarii dosarului la ICCJ | interval start-end | StartDate / EndDate |

### 4.2 Cautare sedinte (`/737`)
Sectie + Data (interval). (Optional in v1; util pentru monitoring de sedinte.)

### 4.3 Dropdown Sectie -> `frontend/src/lib/iccjSectii.ts` (exact de pe site)
```
""   -> Toate
154  -> Sectia I civila
155  -> Sectia a II-a civila
157  -> Sectia Penala
158  -> Sectia de Contencios Administrativ si Fiscal
163  -> Sectiile Unite
182  -> Completul de 9 Judecatori
183  -> Completul de 9 judecatori (Legea nr. 304/2004)
190  -> Completurile de 5 judecatori
202  -> Completul pentru dezlegarea unor chestiuni de drept
210  -> Completul pentru solutionarea recursurilor in interesul legii
```
Pe `/738`, Department primeste ID-ul numeric (154 etc.). Fisierul mapeaza label <-> id. Pattern ca `institutii.ts`.

### 4.4 Format date (VERIFICAT 2026-06-06)
Output site = DD.MM.YYYY (ex. `06.06.2026`). La intrare StartDate/EndDate accepta AMBELE formate: `DD.MM.YYYY` SI `YYYY-MM-DD` (testat: POPESCU + interval 2016-2019 -> 3 rezultate identice in ambele formate). Intern app = ISO; trimite ISO direct (merge) sau converteste — helper de conversie pentru afisare (DD.MM.YYYY -> ISO la parse).

---

## 5. Tipul Dosar extins (backend `iccj.ts` + `frontend/src/types/index.ts`)
Campuri optionale (undefined pentru PortalJust):
```ts
numarVechi?: string;
dataInitiala?: string;
stadiulProcesualCombinat?: string;
obiecteSecundare?: string;
caiAtac?: { dataDeclarare: string; parteDeclaratoare: string; tipCaleAtac: string }[];
source?: "portaljust" | "iccj";
```
`DosarParte` ICCJ: in plus `calitateaProcesualaAnterioara?`, `data?` (ultima comunicare). `id` intern ICCJ se pastreaza pe rezultatul de lista pentru fetch-ul de detaliu.

---

## 6. API (rute Hono)
- `GET /api/dosare?source=iccj&numarDosar=&sectie=&numeParte=&obiect=&dataStart=&dataStop=` -> proxeaza live; raspuns `{ data: Dosar[], total }`, `source:"iccj"` pe fiecare item. (Lista = summary.)
- `GET /api/dosare-iccj/:id` -> detaliu complet (lazy, la expandare). `:id` validat NUMERIC-ONLY + cap lungime (Codex #9 — nu accepta id arbitrar).
- WEB mode: NU sub `rejectCaptchaKeyInWebMode()` (nu e captcha/RNPM), DAR AUTENTIFICATE ca restul API + rate-limit dedicat per owner/user+IP (Codex #9 — ruta genereaza trafic extern, poate fi folosita ca amplificator catre www.scj.ro; "date publice" != "ruta nepericuloasa"). Cookie ICCJ / HTML brut NICIODATA in logs/audit.
- Body limits + rate limits dedicate (refolosesc pattern-ul existent).
- Link extern source-aware: `getDosarExternalUrl({ source, numar, iccjId })` -> www.scj.ro pt ICCJ, NU `getPortalJustUrl` (Codex #6).
- Whitelist URL extern: adauga `www.scj.ro` (langa portal.just.ro etc.).

---

## 7. Frontend (selector de sursa pe pagina Dosare)
- Toggle sursa pe `Dosare.tsx`: PortalJust | ICCJ (comuta sursa, NU merge).
- sursa=ICCJ: `InstitutieSelect` inlocuit de dropdown Sectie (`iccjSectii.ts`); raman numarDosar/numeParte/obiect/interval-data.
- Rezultate in `DosareTable` + badge "ICCJ". Detaliu (termene/cai atac) fetch lazy la expandare rand. Coloanele extra afisate doar cand exista.
- Refolosire: `DosareTable`, export XLSX/PDF, tipuri.

---

## 8. Monitoring (kind nou `iccj`)
- Migration: extinde CHECK `monitoring_jobs.kind` la `('dosar_soap','name_soap','aviz_rnpm','iccj')`.
- `target_json`: `{ numar_dosar }` sau `{ name_normalized, sectie? }`.
- Runner `backend/src/services/monitoring/iccjRunner.ts`: ruleaza `cautareDosareIccj` live (+ detaliu), build snapshot, diff vs ultimul snapshot. Refoloseste logica/diff din `dosarSoapRunner.ts`. Respecta `MONITORING_DISABLED_KINDS`. Wire in scheduler prin DI.
- Alerte existente: `dosar_new`, `termen_new`, `termen_changed`, `solutie_aparuta`, `dosar_disappeared`, `source_error`. Optional `cale_atac_noua` (extensie CHECK).
- GUARD: aplica regula din 3 (sesiune/parse fail -> `source_error`, niciodata fals gol/`disappeared`).
- Politicos: rate limiting intre joburi (vezi 1.4 + 11).

---

## 9. Harta de refolosire
| Existent | Refolosire |
|---|---|
| `soap.ts` (structura modul) | sablon pentru `iccj.ts` (proxy + parse + signals) |
| `Dosar`/`DosarParte`/`DosarSedinta` | extinse cu campuri optionale + `source` |
| `DosareTable` + export | integral |
| `Dosare.tsx` + `SearchForm` | + toggle sursa + dropdown sectie |
| `dosarSoapRunner` + scheduler + diff | sablon pentru `iccjRunner` |
| alert kinds + dedup + snapshots (owner-scoped) | integral |
| `institutii.ts` (pattern enum->UI) | sablon pentru `iccjSectii.ts` |

---

## 10. Phase 0 — verificare (mic acum; RO-side unde e marcat)
1. Paginarea exacta: structura Pager (HTML `<ol>`) + cum se cere pagina N (param in POST?), ca sa epuizezi un set >50/pagina pana la cap 1000. (Search/DocketNumber/PartyName/interval/istoric + formatul datelor — deja VERIFICATE, vezi 1.2/4.4.)
2. Robustetea parse-ului: confirma markup-ul `Items` (`<tr>` columns) si pagina detaliu pe 3-4 dosare variate (penal/civil/contencios). Salveaza fixtures pentru teste.
3. Comportament cookie/sesiune: TTL, cand expira, daca exista throttling la POST-uri repetate (relevant pt monitoring).
4. (Optional, doar ca date pentru review) confirma daca Vector B `api.scj.ro:97` mai e viu in fereastra 3:30-6:30 din RO. Nu schimba decizia (monitoring = live), dar e informatia care ar permite fallback la canalul sanctionat daca rate/intentie devin problema.

---

## 11. Riscuri
- Scraping HTML fragil (markup site se poate schimba) -> parse defensiv + fixtures + teste; degradare eleganta la `source_error`.
- Dependenta de sesiune (cookie) -> management cookie cu refresh; fail = `source_error` (NU fals gol). Vezi guardul din 3/8.
- Uptime/rate site live: fiecare search/monitor run = hit live. Monitoring la scara = comportament de crawler pe care ICCJ a cerut explicit sa-l evite (1.4). Mitigare: rate limit + concurenta mica + cadenta minima generoasa + (viitor) migrare monitoring pe Vector B/C.
- HTTPS dar website public — fara auth; date publice. Documenteaza in SECURITY.md (whitelist `www.scj.ro`).
- `numar` nu e cheie globala (1.1) — nu-l trata ca atare cross-sursa.

## 12. Riscuri acceptate
- Search interactiv depinde de uptime-ul www.scj.ro (ca PortalJust de portalquery.just.ro).
- Conversie diacritice/format date — gestionate prin helpers (ca `toLegacyDiacritics` la SOAP).

---

## 13. Out of scope
- Jurisprudenta (text decizii) — neexpusa de ICCJ pe acest flux.
- Corpus local / mirror / arhiva (Vector C) — abandonat in favoarea live-proxy; reconsiderat doar daca rate/uptime devin probleme.
- Merge unificat PortalJust + ICCJ in aceeasi lista — s-a ales toggle de sursa.
- Dosar electronic ICCJ (`doc.iccj.ro`) — necesita autentificare individuala.
- Cautare sedinte (`/737`) — optional dupa v1.

---

## 14. Checklist de implementare (dupa GO la Phase 0)
1. `backend/src/iccj.ts` (search proxy + detaliu + session + parse defensiv + signals + cap).
2. `frontend/src/lib/iccjSectii.ts` (11 optiuni).
3. Extindere tip `Dosar` (backend + frontend) cu campuri optionale + `source` + `id` intern.
4. Rute Hono: `/api/dosare?source=iccj` + `/api/dosare-iccj/:id` + whitelist `www.scj.ro` + rate/body limits.
5. `Dosare.tsx`: toggle sursa + dropdown sectie; `DosareTable`: badge sursa + coloane extra + detaliu lazy.
6. Migration: extinde CHECK `kind` la `iccj` (+ optional `cale_atac_noua` la alert kinds).
7. `iccjRunner.ts` + wire in scheduler + kind in UI Monitorizare + guard source_error.
8. Teste: parse rows + parse detaliu (fixtures), conversie date, guard source_error, mapare filtre, runner diff.
9. Rate limiting/politete pentru monitoring (1.4 / 11).
10. Docs la release: CHANGELOG, README, SECURITY (scraping `www.scj.ro` + whitelist), in-app changelog, CLAUDE.md daca apare conventie noua.

---

## 15. Dispozitia review-ului Codex (2026-06-06)

Citarile de cod ale Codex au fost VERIFICATE si sunt corecte (regex `NUMAR_DOSAR_RE` la `schemas/monitoring.ts:24`; `kind` hardcodat la `:97-119`/`:153`; `SOURCE_ERROR_THRESHOLD=5` la `scheduler.ts:43,592`). Dispozitie per finding:

| # | Finding | Sev | Dispozitie |
|---|---|---|---|
| 1 | Monitoring live = comportament de crawler vs intentia canalului sanctionat | BLOCKER | RESPINS de owner. Risc acceptat explicit ("vom vedea live"). Monitoring ramane live, full, in v1. |
| 2 | "Rate limit generos" prea vag, fara per-host queue/cifre | BLOCKER | PARTIAL. Fara gate/ack/caps hard. Se pastreaza DOAR fiabilitate: per-host queue concurrency 1 pe www.scj.ro + kill switch `MONITORING_DISABLED_KINDS=iccj`. Cifre exacte: observam live. |
| 3 | Guard fals-gol insuficient ca mecanism | HIGH | ACCEPTAT integral (corectitudine). Vezi sectiunea 3 (clasificator empty-real vs fals, no-snapshot-ambiguu, source_error la primul esec). |
| 4 | Parser drift poate esua tacut | HIGH | ACCEPTAT. Invarianti minimi per `<tr>` (numar, link cu `Value=<id>`, data, stadiu, sectie) si per detaliu (numar == summary, data, termene/parti detectate sau explicit empty) -> `IccjParseError`. Fixtures penal/civil/contencios + dosar fara termen viitor. Log `iccj.markup_drift` cu hash template + camp lipsa, FARA HTML brut. Teste de drift: coloana lipsa, link fara id, `Items` non-string, `Pager` absent cand `Keywords` zice N. |
| 5 | Monitoring pe nume = blast radius mare | HIGH | PARTIAL (owner vrea full). Se pastreaza monitoring pe nume, DAR paginare completa pana la cap 1000 + fetch detaliu doar pe schimbari (nu pe toate rezultatele); observam load live. Search interactiv pe nume = paginare UI + detaliu lazy. |
| 6 | `numar` coliziune semantica cross-sursa in link/export | HIGH | ACCEPTAT. `source` intra in snapshot payload + alert detail + export rows. Link helper nou `getDosarExternalUrl({ source, numar, iccjId })`; NU reutiliza `getPortalJustUrl`. Dedup keys ICCJ namespace-uite `iccj|...`. `DosareTable` afiseaza "ICCJ" + link extern catre www.scj.ro. |
| 7 | Schema/Zod subestimate ("o singura tabela") | MED | ACCEPTAT. Contracte de atins: migration REBUILD `monitoring_jobs` (SQLite nu altereaza CHECK in place), `schemas/monitoring.ts` (discriminated union `:97-119` + list enum `:153`), teste schema, list filters, dashboard counts, alert labels, export labels, UI tabs Monitorizare, scheduler registry. Test de boot pe DB MIGRATA, nu doar fresh. |
| 8 | Regex numar dosar respinge exemple ICCJ | MED | ACCEPTAT. `TargetIccjByNumber` SEPARAT (nu reutiliza `TargetDosarSoap`), testat pe `107/213/2017**`, `250/2/2019/a3`, `1859/107/2009**/a3.1`. Normalizeaza doar whitespace; NU elimina `**` sau `.` (semnificative la ICCJ). |
| 9 | Web mode nu e low-risk doar pt date publice | MED | ACCEPTAT (securitate de baza). Rute ICCJ in web mode AUTENTIFICATE ca restul API; `:id` validat numeric-only + cap lungime; cookie ICCJ / HTML brut NICIODATA in logs/audit. Rate-limit dedicat: light, observam live. Documenteaza in SECURITY.md ca endpointurile NU sunt proxy public. |
| 10 | Paginarea e blocker functional, nu detaliu | MED | ACCEPTAT. Search interactiv: pagina 1 + `hasMore`/`nextPage`, NU auto-sweep 1000 la fiecare click. Monitoring: paginare determinista + capped. Phase 0: fixtures Pager + test pagina 2. |
| 11 | Retentie/minimizare date personale | LOW | ACCEPTAT. Snapshot monitoring pastreaza DOAR campurile necesare diff-ului (nu HTML brut, nu PDF). Detalii complete = fetch-on-demand in UI. Emails/alerts: minim + link, nu lista completa de parti. |

Net: search interactiv = neschimbat, GO. Monitoring live = ramane in v1 (decizie owner), dar cu corectitudinea/securitatea din #3/#4/#6/#7/#8/#9/#10/#11 obligatorii. Gating-ul de abuz (#1, parte din #2/#5) — respins.
