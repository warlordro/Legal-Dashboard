# CODEX — Adversarial review: integrare cautare ICCJ

Rol: esti reviewer ADVERSARIAL. Scopul tau NU e sa validezi planul, ci sa-l spargi:
gaseste asumptii gresite, failure modes, edge cases, riscuri de abuz/legal, si variante mai simple.
Nu lustrui DDL/stil. Ataca FUNDATIA si deciziile, nu cosmetica.

Citeste intai: `PLAN-iccj-integration.md` (specul complet). Documentul de fata e brief-ul de atac + evidenta.

---

## 0. Context minim

Legal Dashboard = app Electron (+ viitor web) care cauta dosare la instantele din Romania prin SOAP
(`portalquery.just.ro`, modul `backend/src/soap.ts`) + un modul RNPM (HTTP scraping + captcha).
Se adauga o sursa noua: dosarele Inaltei Curti de Casatie si Justitie (ICCJ), care NU sunt in portalquery.
Decizii deja luate de owner (NU le recontesta ca preferinta, dar PoTI ataca consecintele tehnice):
1. Scope = search interactiv + monitoring.
2. UI = selector de sursa (toggle PortalJust | ICCJ) pe pagina Dosare, fara merge.
3. Arhitectura = LIVE-PROXY (oglindeste `soap.ts`), fara corpus/arhiva locala.
4. ATAT search CAT SI monitoring sunt live (per job + snapshot diff, ca `dosarSoapRunner`).

---

## 1. Ce e VERIFICAT empiric vs ce e ASUMAT (critic — nu pierde timp pe fundatii inexistente)

### VERIFICAT (probe reale, 2026-06-06):
- portalquery.just.ro NU contine ICCJ: `2831/1/2019` -> 0; `2310/1/2000` -> 0; "BANCA TRANSILVANIA SA" -> 1000 dosare, 0 cu instanta "Inalta Curte". (=> sursa noua reala, fara dublare la nivel de inregistrare.)
- Search-ul live ICCJ FUNCTIONEAZA ziua, fara fereastra orara: `POST https://www.scj.ro/738/...` cu cookie de sesiune -> PartyName=POPESCU -> "136 rezultate" cu date reale.
- Raspuns search = JSON envelope cu `Items` = STRING HTML (`<tr>` rows), `Pager` = HTML, `Status:1`. (Deci scraping, nu JSON curat.)
- Cookie de sesiune OBLIGATORIU: fara el, raspuns = `{"Keywords":"Nu sunt rezultate.","Items":null,"Status":1}` (FALS gol). Cu GET prealabil pe pagina -> cookie jar -> POST = rezultate reale.
- Pagina de detaliu functioneaza: `GET /1094/Detalii-dosar?...Value=<id_intern>` -> HTML complet (numar vechi, data formarii, etc.), cu optiune "Descarca PDF". id_intern vine din linkul din lista (ex. 100000000360872).
- Formularul `/738` (verificat in DOM randat): campuri = Numarul dosarului, Sectie (dropdown 11 optiuni), Nume parte, Obiectul dosarului, Data formarii (interval). Filtrul "Sectie" NU era in API-ul documentat 2019.
- DocketNumber search MERGE: `nr=1085/1/2026` (cu cookie) -> 1 rezultat.
- ISTORICUL E ACOPERIT (nu e recent-only): POPESCU restrans la interval 2016-2019 -> 3 dosare din 2019. "All-2026" pe pagina 1 = artefact de SORTARE DESC (data descrescator), nu limita de acoperire. => paginarea e obligatorie pt set complet.
- Format date StartDate/EndDate: AMBELE accepta — `DD.MM.YYYY` SI `YYYY-MM-DD` (rezultat identic).
- Edge: `nr=2831/1/2019` (exemplul din doc 2019) -> 0 chiar cu cookie. Absenta punctuala a acelui dosar, NU limita sistemica (vezi acoperirea istorica de mai sus). De investigat la fixtures.

### ASUMAT / NEVERIFICAT (Phase 0):
- Structura exacta a Pager-ului + cum se cere pagina N (paginare pana la cap 1000).
- TTL-ul cookie-ului + daca exista throttling la POST-uri repetate (CRITIC pt monitoring).
- Structura completa a paginii de detaliu (parti cu calitate, termene, cai atac) pe tipuri variate de dosar (penal/civil/contencios) — de confirmat cu fixtures.
- Vector B `api.scj.ro:97` (serviciul web JSON 2019) e viu? Probe: DNS rezolva (85.120.166.221), dar GET port 97 = timeout (poate fereastra orara 3:30-6:30, poate geo-block, poate mort — nedistinctibil din afara RO).

---

## 2. Asumptiile pe care le vrem ATACATE primele (impact mare)

### A1. Live-scraping pe website vs canalul sanctionat (intentie/ToS) — CEA MAI CONTESTABILA
Doc-ul oficial ICCJ 2019 spune textual ca serviciul web `api.scj.ro:97` a fost creat
"in vederea degrevarii site-ului web al ICCJ de aplicatiile automate (crawlere)".
Adica owner-ul datelor a cerut explicit ca tool-urile automate sa NU scrape-uiasca website-ul, ci sa foloseasca web service-ul.
Planul alege totusi scraping pe `/738` (website) — si pentru search SI pentru monitoring automat.
Intreaba-te / argumenteaza:
- E aparabil pentru search interactiv (user-driven)? Dar pentru monitoring programat la scara?
- Care e expunerea legala/operationala (blocare IP, ToS, GDPR pe date publice)?
- E gresita decizia de a IGNORA Vector B/C (canalul sanctionat) doar pentru ca n-am confirmat ca-s vii?
  Ce cost-beneficiu real (efort de a confirma B/C vs risc de scraping)?

### A2. Fals-gol / fail de sesiune -> alerte false de "disappeared" (CORECTITUDINE)
`Items:null` apare si cand cookie-ul e invalid (fals gol), nu doar cand chiar nu-s rezultate.
In monitoring, un fail de sesiune/markup interpretat ca "0 rezultate" => alerta falsa `dosar_disappeared`.
Planul cere guard: sesiune/parse fail -> `source_error`, niciodata rezultat gol (sectiunea 3 din PLAN).
Ataca: e suficient guardul? Cum distingi robust "chiar 0 rezultate" de "sesiune moarta/markup schimbat"?
Ce heuristici (Status, Keywords="N rezultate" vs "Nu sunt rezultate", prezenta Pager, sanity-check pe un query de control)?

### A3. Fragilitate scraping HTML + mentenanta
`Items` e markup server-rendered; orice schimbare de template ICCJ poate sparge parserul tacut.
Ataca: strategia de parse defensiv + fixtures + teste e suficienta? Cum detectezi early un markup-drift
(nu prin "0 rezultate" tacut)? Versionare/canary?

### A4. Rate/politete pentru monitoring live pe site guvernamental
Fiecare run de monitoring = hituri live (search + N fetch-uri de detaliu). La multe joburi = crawler.
Ataca: planul are doar "rate limit + cadenta generoasa". E concret/suficient? Risc de ban IP care
ar rupe SI search-ul interactiv (acelasi host)? Ar trebui search si monitoring sa fie izolate?

### A5. `numar` nu e cheie globala (cross-sursa)
Un dosar ICCJ pe recurs pastreaza numarul instantei de origine (ex. `6945/306/2015`), deci acelasi numar
poate exista in PortalJust (faza inferioara) SI la ICCJ. Ataca orice loc unde codul ar putea trata
`numar` ca identificator unic global (dedup, snapshot key, monitoring target hash).

---

## 3. Puncte tehnice de scrutinat in implementarea propusa
- `backend/src/iccj.ts` (mirror `soap.ts`): management cookie (cache+TTL+refresh), `AbortSignal.any` + timeout + cap pe response size, parse rows + parse detaliu. Vezi sectiunea 3 din PLAN.
- 2-hop (lista summary -> detaliu per id): cost la search (lazy la expandare) vs la monitoring (necesar pt diff termene). E corect impartit?
- Conversie date ISO <-> DD.MM.YYYY (helper, ca `toLegacyDiacritics`). Edge: dosare fara data, format `**`/suffix in numar (`1859/107/2009**/a3.1`).
- Rute: `GET /api/dosare?source=iccj` + `/api/dosare-iccj/:id`; disponibile in WEB mode (date publice, NU sub `rejectCaptchaKeyInWebMode()`). Corect din punct de vedere securitate?
- Monitoring: kind nou `iccj`, runner refoloseste diff din `dosarSoapRunner`, snapshots raman owner_id-scoped (FARA corpus global => fara violare invariant `owner_id`). Verifica ca nu se introduce nicio tabela non-owner-scoped.
- Whitelist URL extern: adauga `www.scj.ro`. Verifica ca nu se largeste accidental suprafata.

---

## 4. Ce livrezi (output review)
Lista de findings, fiecare cu: severitate (BLOCKER/HIGH/MED/LOW), asumptia atacata (A1..A5 sau altele noi),
de ce e o problema, si recomandare concreta (inclusiv variante mai simple/sigure daca exista).
Prioritizeaza A1-A4. Daca gasesti un motiv solid sa NU folosim live-proxy (sau sa-l limitam doar la search,
cu monitoring pe Vector B/C), spune-l clar cu argumentare cost/risc.
NU propune corpus/arhiva ca "must" decat daca ai argument tare — owner-ul l-a respins explicit pe baza
ca Vector A merge ziua si pattern-ul live e fix cel existent (`soap.ts`).

---

## 5. Anexa — evidenta bruta (pentru distinctie verificat/asumat)

### 5.1 Probe portalquery (control acoperire)
```
POST http://portalquery.just.ro/query.asmx  (CautareDosare)
numarDosar=2831/1/2019 -> <CautareDosareResponse/> gol (0 Dosar)
numarDosar=2310/1/2000 -> 0
numeParte=BANCA TRANSILVANIA SA -> 1000 Dosar; 0 institutie "Inalt/Casat"
```

### 5.2 Search live ICCJ (envelope real)
```
GET https://www.scj.ro/738/Cautare-dosare-si-parti   (seteaza cookie sesiune)
POST https://www.scj.ro/738/C%C4%83utare%20dosare%20%C5%9Fi%20p%C4%83r%C5%A3i
  Content-Type: application/x-www-form-urlencoded ; X-Requested-With: XMLHttpRequest ; cookie jar
  body: formTypeId=6 & websiteId=0 &
        CustomQuery[0].Key=DocketObject & CustomQuery[0].Value=
        CustomQuery[1].Key=Department   & CustomQuery[1].Value=
        CustomQuery[2].Key=DocketNumber & CustomQuery[2].Value=
        CustomQuery[3].Key=PartyName    & CustomQuery[3].Value=POPESCU
        CustomQuery[4].Key=StartDate    & CustomQuery[4].Value=
        CustomQuery[5].Key=EndDate      & CustomQuery[5].Value=
=> 200, application/json:
{"Keywords":"136 rezultate","ExtraData":{"Sort":{"Direction":0,"Type":2}},
 "Items":"<tr><td>1</td><td><a href=\"/1094/Detalii-dosar?customQuery[0].Key=id&customQuery[0].Value=100000000360872\">1085/1/2026</a></td><td>04.06.2026</td><td>calcul drepturi salariale</td><td>Sesizare prealabila</td><td>Completul pentru dezlegarea unor chestiuni de drept</td><td><ul><li>POPESCU CORNELIU-LIVIU</li><li>UNIVERSITATEA DIN BUCURESTI</li></ul></td></tr> ...",
 "Pager":"<ol class=...>...</ol>","Status":1,"Message":""}

Fara cookie: {"Keywords":"Nu sunt rezultate.","Items":null,"Status":1}  (FALS gol — vezi A2)
```

### 5.3 Detaliu dosar
```
GET https://www.scj.ro/1094/Detalii-dosar?customQuery%5B0%5D.Key=id&customQuery%5B0%5D.Value=100000000360872
=> 200 text/html (~22KB): "Numarul dosarului: 1085/1/2026", "Numarul vechi: -",
   "Data formarii dosarului la ICCJ: 04.06.2026", ... + termene/parti/cai atac + "Descarca PDF".
```

### 5.4 Dropdown Sectie (de pe /738, label -> id Department)
```
"" Toate | 154 Sectia I civila | 155 Sectia a II-a civila | 157 Sectia Penala |
158 Contencios Administrativ si Fiscal | 163 Sectiile Unite | 182 Complet 9 Judecatori |
183 Complet 9 (L.304/2004) | 190 Completurile de 5 | 202 Dezlegarea unor chestiuni de drept |
210 Recursuri in interesul legii
```

### 5.5 Serviciu web 2019 (Vector B/C — sanctionat, neconfirmat viu)
```
http://api.scj.ro:97/api/CautareDosare?nr=&obiect=&parte=&dataStart=&dataEnd=   (JSON curat)
http://api.scj.ro:97/api/CautareSedinte?data=
Fereastra metode live: 3:30-6:30 AM. Plus arhive JSON zilnice (toate dosarele+sedintele), link static (negasit).
Doc: scj.ro "Documentarea serviciului web de conectare programatica la date", v1.0 oct 2019.
```
