# CODEX - Adversarial review: integrare ICCJ

Data review: 2026-06-06  
Input principal: `PLAN-iccj-integration.md` + `CODEX-REVIEW-iccj-integration.md`  
Mod review: adversarial, orientat pe fundatie, failure modes, risc operational/legal si alternative mai simple.

Active roles: Apex lead (arhitectura), Warden (security/legal/abuse), Vigil (operational reliability), Proof (test/validation).

## Verdict executiv

Planul este fezabil pentru search interactiv ICCJ prin Vector A (`www.scj.ro` `/738`), cu detalii lazy si parser defensiv.

Nu este suficient de defensibil pentru monitoring automat live pe acelasi Vector A in forma actuala. Motivul nu este tehnic pur, ci combinat: documentatia oficiala ICCJ descrie un serviciu web programatic creat pentru a degreva site-ul de crawlere, iar planul alege exact website scraping pentru un flux automat recurent. Search-ul interactiv poate fi aparat ca echivalent al unei actiuni umane. Monitoringul programat este comportament de crawler.

Recomandare de decizie:

1. GO conditional pentru search interactiv ICCJ pe Vector A.
2. NO-GO pentru monitoring automat live pe Vector A pana cand Phase 0 produce fie dovada ca Vector B/C nu este utilizabil, fie o decizie explicita de acceptare a riscului cu limite concrete.
3. Daca ownerul mentine live-monitoring pe website, lansarea trebuie sa fie opt-in, cu kill switch dedicat, per-host queue, cadenta minima mare si cap strict pe joburi/zi. Nu il lansa ca feature implicit.

## Evidence Pack

Surse locale:

- `PLAN-iccj-integration.md:5` fixeaza decizia: search si monitoring sunt live, fara corpus.
- `PLAN-iccj-integration.md:30-33` recunoaste tensiunea cu serviciul web sanctionat.
- `PLAN-iccj-integration.md:66-75` documenteaza fals-golul prin cookie invalid si guard-ul cerut.
- `PLAN-iccj-integration.md:147-153` propune `kind=iccj`, reuse de runner/diff si politete generica.
- `backend/src/schemas/monitoring.ts:97-119` arata ca `JobKind` este discriminated union hardcoded.
- `backend/src/db/migrations/0003_monitoring_core.up.sql:24-45` arata CHECK-ul initial pe `monitoring_jobs.kind` si UNIQUE `(owner_id, target_hash, kind)`.
- `backend/src/services/monitoring/scheduler.ts:40-44` arata pragul generic de 5 failures si backoff 1h.
- `backend/src/services/monitoring/scheduler.ts:587-615` arata ca `source_error` se emite abia la tranzitia 4 -> 5.
- `electron/main.js:422-435` arata whitelist strict de domenii externe, momentan fara `www.scj.ro`.
- `backend/src/routes/dosare.ts:100-175` arata ruta actuala `/api/dosare`, validarea si fanout-ul PortalJust.
- `backend/src/soap.ts:94-118` arata modelul existent de timeout + `AbortSignal.any`.

Sursa oficiala ICCJ:

- Documentul ICCJ "Documentarea serviciului web de conectare programatica la date", v1.0 octombrie 2019, `https://www.scj.ro/cms/0/publicmedia/getincludedfile?id=21209`.
- In sectiunea "Descriere generala", documentul spune ca serviciul web a fost creat pentru degrevarea site-ului ICCJ de aplicatii automate si crawlere si expune datele in JSON. Acelasi document precizeaza fereastra de acces 3:30-6:30 AM pentru metodele serviciului web.

## Findings

### 1. BLOCKER - Monitoring live pe website incalca intentia canalului programatic

Asumptie atacata: A1.

Problema: Planul alege Vector A pentru search si monitoring deoarece functioneaza ziua (`PLAN-iccj-integration.md:21-33`). Pentru search interactiv, argumentul este rezonabil. Pentru monitoring, argumentul se rupe: acesta este automat, recurent si poate scala cu numarul de joburi. Documentul oficial ICCJ descrie explicit un serviciu web programatic pentru a evita crawlerele pe website, iar planul propune exact crawler pe website.

Impact: risc de blocare IP, degradare a search-ului interactiv pe acelasi host, incident operational greu de explicat si risc reputational/policy. Faptul ca datele sunt publice nu rezolva problema de intentie si incarcare.

Recomandare: separa decizia:

- `source=iccj` search interactiv pe `/738`: OK conditional.
- `kind=iccj` monitoring pe `/738`: disabled by default pana la Phase 0 B/C.
- Adauga un gate explicit, de tip `ICCJ_LIVE_WEBSITE_MONITORING_ACK=1`, doar daca ownerul accepta formal riscul.
- Phase 0 trebuie sa includa test real in fereastra 3:30-6:30 RO pentru Vector B si cautarea URL-ului de arhiva C. Nu ca "optional"; este blocker pentru monitoring automat.

Varianta mai simpla: livreaza v1 doar cu search interactiv + detaliu lazy. Adauga monitoring intr-un PR separat dupa dovada B/C sau dupa acceptarea riscului.

### 2. BLOCKER - "Rate limit + cadenta generoasa" este prea vag pentru un crawler de institutie publica

Asumptie atacata: A4.

Problema: Planul spune "rate limiting intre joburi" (`PLAN-iccj-integration.md:153`) si "cadenta minima generoasa" (`PLAN-iccj-integration.md:181`), dar nu defineste buget numeric. Schedulerul curent are infrastructura generica, fail streak generic si `MONITORING_DISABLED_KINDS`, dar nu are per-host queue sau buget separat pentru `www.scj.ro`. Mai grav, `createJob` seteaza `next_run_at` imediat la creare (`backend/src/db/monitoringJobsRepository.ts:90-96`), deci un import/serie de joburi ICCJ poate incepe imediat.

Impact: un batch de joburi ICCJ poate genera search + N detail fetch-uri, exact tiparul de crawler. Daca hostul blocheaza IP-ul, se rupe si search-ul interactiv pentru utilizator.

Recomandare concreta:

- Per-host queue `www.scj.ro` cu concurrency 1.
- Token bucket separat pentru interactive si monitoring.
- Monitoring ICCJ: default `cadence_sec >= 86400` sau cel putin 12h, nu 10min/4h.
- Cap global: max X joburi ICCJ active per owner si max Y requesturi ICCJ/zi.
- `MONITORING_DISABLED_KINDS=iccj` documentat in `SESSION-HANDOFF.md` si `SECURITY.md`.
- Manual run pentru ICCJ sa respecte aceeasi coada, fara bypass.

Go condition: cifrele trebuie scrise in plan inainte de implementare. Fara cifre, feature-ul este operational nedefinit.

### 3. HIGH - Guard-ul fals-gol este corect ca intentie, dar insuficient ca mecanism

Asumptie atacata: A2.

Problema: `Items:null` + `Keywords:"Nu sunt rezultate."` poate insemna "nu exista rezultate" sau "nu ai cookie/session valid" (`PLAN-iccj-integration.md:66-75`, `CODEX-REVIEW-iccj-integration.md:59-64`). Planul spune sa tratezi parse/session fail ca `source_error`, dar nu defineste clasificatorul care separa empty real de empty fals. In plus, schedulerul generic emite `source_error` abia la 5 esecuri consecutive (`backend/src/services/monitoring/scheduler.ts:40-44`, `587-615`). Pentru o sursa unde fals-golul poate produce `dosar_disappeared`, 5 rulari sunt prea tarziu daca runnerul a scris snapshot gol.

Impact: alerta falsa `dosar_disappeared` erodeaza increderea in monitorizare. Si mai rau, daca snapshot-ul gol este persistat, baseline-ul devine corupt si urmatoarea rulare poate produce `dosar_new` fals.

Recomandare concreta:

- Introdu un tip explicit `IccjSourceError` si `IccjParseError`; runnerul nu primeste niciodata `[]` pentru session/markup fail.
- Pentru monitoring, nu persista snapshot cand clasificarea este ambigua.
- La `Items:null` cu query care anterior avea rezultat sau cand cookie-ul a fost refresh-uit recent: retry o singura data cu GET fresh + POST.
- True empty este acceptat doar cand: session a fost obtinuta in aceeasi incercare sau validata, `Status === 1`, `Items === null`, `Keywords` are forma asteptata, si pagina nu contine semne de redirect/anti-bot/markup error.
- Adauga canary optional, dar limitat: un query de control rar, nu la fiecare job.
- `source_error` pentru ICCJ session/parse trebuie emis la primul esec ambiguu ca alert operational intern sau macar log structured, nu doar la 5 failures, pentru ca nu este un transient SOAP obisnuit.

### 4. HIGH - HTML scraping drift poate esua tacut, iar planul nu cere contracte de parser suficient de tari

Asumptie atacata: A3.

Problema: `Items` este HTML string (`PLAN-iccj-integration.md:67-69`), nu JSON structurat. Planul cere fixtures, dar nu spune ce invarianti trebuie validate. Un parser tolerant poate transforma markup schimbat in randuri partiale, `id` lipsa, sedinte lipsa sau `[]`, fara eroare.

Impact: fie ratezi alerte, fie generezi alerte false. In ambele cazuri monitorizarea devine nesigura exact in zona cu miza mare.

Recomandare concreta:

- Parserul de lista trebuie sa valideze minim: fiecare `<tr>` are numar, link detail relativ cu `Value=<id>`, data formarii, stadiu, sectie/complet; altfel `IccjParseError`.
- Parserul de detaliu trebuie sa valideze minim: numar dosar egal cu summary, data formarii, sectiune termene detectata, parti detectate sau explicit empty.
- Salveaza fixtures HTML brute, sanitizate, pentru penal/civil/contencios si pentru dosar fara termen viitor.
- Teste de "markup drift": coloana lipsa, link fara id, `Items` non-string, `Pager` absent cand `Keywords` zice N rezultate.
- Log structured `iccj.markup_drift` cu hash de template si campul lipsa, fara HTML brut in log.

### 5. HIGH - Monitoring pe nume ICCJ are blast radius prea mare pentru v1

Asumptii atacate: A4, A3.

Problema: Planul permite `target_json` fie `{ numar_dosar }`, fie `{ name_normalized, sectie? }` (`PLAN-iccj-integration.md:149`). Pentru numar dosar, load-ul este controlabil. Pentru nume, rezultatul poate fi zeci/sute/1000, iar planul spune ca runnerul face search live plus detaliu pentru diff termene (`PLAN-iccj-integration.md:42-43`, `150`). Asta inseamna multiplicare: 1 search + pana la N detail fetch-uri per job per tick.

Impact: un singur job pe "POPESCU" sau o banca mare poate deveni crawler agresiv. Este si fragil: paginare incompleta sau detalii partiale inseamna snapshot partial si alerte incorecte.

Recomandare concreta:

- V1 monitoring ICCJ doar pentru `{ numar_dosar }`.
- Search interactiv pe nume ramane permis, dar cu paginare UI si detalii lazy.
- Daca se cere neaparat monitoring pe nume, pune cap mic: de exemplu doar daca total <= 10 si doar dupa confirmarea explicita a userului. Peste cap: refuza jobul cu mesaj "monitorizare pe nume prea larga".
- Nu fa detail fetch pentru toate rezultatele la search interactiv; doar la expandare.

### 6. HIGH - `numar_dosar` si link helpers pot coliziona semantic cross-sursa

Asumptie atacata: A5.

Problema: Planul stie ca `numar` nu este cheie globala (`PLAN-iccj-integration.md:15`, `183`). La nivel DB, `UNIQUE(owner_id, target_hash, kind)` ajuta pentru monitoring (`backend/src/db/migrations/0003_monitoring_core.up.sql:44`), dar UI/export/link helpers existente sunt PortalJust-centric. Multe suprafete actuale construiesc linkuri `portal.just.ro` din numar. Daca un dosar ICCJ foloseste numarul de origine, un link sau export poate trimite userul la faza inferioara in PortalJust in loc de ICCJ.

Impact: userul poate crede ca vede dosarul ICCJ, dar ajunge la dosarul/faza PortalJust. In rapoarte si alerte, asta este risc de decizie gresita.

Recomandare concreta:

- `source` trebuie sa intre in snapshot payload, alert detail, export rows si link helpers.
- Link helper nou: `getDosarExternalUrl({ source, numar, iccjId })`; nu reutiliza automat `getPortalJustUrl`.
- Dedup keys pentru ICCJ trebuie namespace-uite cu `iccj|...`, nu doar sedinta key generica.
- `DosareTable` sa afiseze clar "ICCJ" si linkul extern catre `www.scj.ro`, nu PortalJust.

### 7. MED - Planul subestimeaza schimbarile de schema si Zod pentru `kind=iccj`

Asumptie atacata: "singura tabela atinsa".

Problema: Planul spune "Singura tabela atinsa: `monitoring_jobs.kind`" (`PLAN-iccj-integration.md:45`). In realitate, contractul este duplicat in mai multe locuri: SQLite CHECK, Zod discriminated union, list query enum, UI filters, runner registry si alert-kind CHECK daca se adauga `cale_atac_noua`. `JobCreateBodySchema` accepta doar `dosar_soap`, `name_soap`, `aviz_rnpm` (`backend/src/schemas/monitoring.ts:97-119`), iar filtrarea listarii accepta aceleasi trei kinduri (`backend/src/schemas/monitoring.ts:149-153`).

Impact: implementarea poate compila partial dar sa refuze create/list/run pentru `iccj`, sau migration-ul poate pica pe CHECK. SQLite nu poate altera CHECK in place; repo-ul foloseste rebuild-uri pentru astfel de schimbari.

Recomandare concreta:

- Actualizeaza planul cu lista completa de contracte: migration rebuild `monitoring_jobs`, `schemas/monitoring.ts`, tests schema, list filters, dashboard counts, alert labels, export labels, monitoring UI tabs, scheduler registry.
- Daca adaugi `cale_atac_noua`, fa migration separat pe `monitoring_alerts.kind` si teste DOWN fail-loud ca in migratiile existente.
- Include test de boot pe DB migrata, nu doar DB fresh.

### 8. MED - Regex-ul actual pentru numar dosar nu acopera exemple ICCJ documentate

Asumptii atacate: A5, implementability.

Problema: Schema actuala `TargetDosarSoap` accepta doar `1234/180/2024` sau un suffix alfanumeric simplu dupa slash (`backend/src/schemas/monitoring.ts:20-33`). Brief-ul ICCJ mentioneaza exemple cu `**` si `/a3.1` (`CODEX-REVIEW-iccj-integration.md:83-87`), iar planul spune sa tratezi aceste edge cases.

Impact: daca reutilizezi schema PortalJust pentru ICCJ, refuzi dosare ICCJ valide sau fortezi userul sa caute manual fara monitoring.

Recomandare concreta:

- Nu reutiliza `TargetDosarSoap` pentru ICCJ.
- Creeaza `TargetIccjByNumber` cu regex separata, testata pe exemplele oficiale: `107/213/2017**`, `250/2/2019/a3`, `1859/107/2009**/a3.1`.
- Normalizeaza doar whitespace, nu elimina `**` sau `.`, pentru ca pot fi semnificative in ICCJ.

### 9. MED - API web mode nu trebuie tratat ca low-risk doar pentru ca datele sunt publice

Asumptie atacata: "date publice, fara captcha".

Problema: Planul spune ca rutele sunt disponibile in WEB mode si nu intra sub `rejectCaptchaKeyInWebMode()` (`PLAN-iccj-integration.md:131-135`). Corect: nu este captcha/RNPM. Dar asta nu inseamna ca ruta este nepericuloasa. Ea genereaza trafic extern, parseaza HTML si poate fi folosita ca amplificator/proxy catre `www.scj.ro`.

Impact: in web mode, un user autentificat sau un script abuziv poate consuma bugetul ICCJ si poate bloca IP-ul aplicatiei. In desktop, riscul este local; in web, riscul devine shared.

Recomandare concreta:

- Rutele ICCJ in web mode trebuie sa fie autentificate ca restul API-ului.
- Rate limit dedicat pe owner/user + IP, separat de PortalJust.
- Nu expune detaliu arbitrary `:id` fara validare stricta numeric-only si cap de lungime.
- Nu include cookie ICCJ sau HTML brut in logs/audit.
- Documenteaza in `SECURITY.md` ca `www.scj.ro` este sursa externa noua si ca endpointurile nu sunt public proxy.

### 10. MED - Paginarea este blocker functional, nu detaliu Phase 0 "mic"

Asumptie atacata: A3/A4.

Problema: Planul recunoaste ca pagina 1 nu este set complet si ca trebuie paginare pana la cap 1000 (`PLAN-iccj-integration.md:72-73`, `170-174`). Daca implementarea nu rezolva paginarea inainte de UI/monitoring, search-ul dupa nume va fi incomplet si monitoringul pe nume va avea baseline fals.

Impact: false negatives. Userul vede doar cele mai noi dosare si crede ca istoricul lipseste. Monitoringul poate emite alerte cand un dosar apare pe pagina 1 prin sortare, desi exista deja in pagina N.

Recomandare concreta:

- Pentru search interactiv: returneaza prima pagina + `nextPageToken`/`hasMore`, nu auto-sweep 1000 la fiecare click.
- Pentru monitoring: nu permite targets care necesita sweep mare pana cand paginarea este determinista si capped.
- Phase 0 trebuie sa salveze fixtures pentru Pager si test de "page 2".

### 11. LOW - Retentia si minimizarea datelor personale trebuie mentionate explicit

Asumptie atacata: privacy/legal.

Problema: Datele sunt publice, dar numele partilor sunt tot date personale. Planul pastreaza snapshot-uri owner-scoped, ceea ce este bun, dar nu spune daca snapshot-ul ICCJ stocheaza toate partile, calitati, cai de atac si detalii solutie pentru fiecare run.

Impact: crestere inutila a DB-ului si expunere inutila in backup/export/email.

Recomandare concreta:

- Snapshot monitoring sa pastreze doar campurile necesare diff-ului, nu HTML brut si nu PDF.
- Detaliile complete sa fie fetch-on-demand in UI.
- Emails/alerts sa includa minimul necesar si link, nu lista completa de parti.
- Documenteaza retentia existenta si faptul ca `monitoring_snapshots` ramane owner-scoped.

## Plan minim revizuit

### Phase 0 obligatorie

1. Verifica Vector B in fereastra 3:30-6:30 RO si noteaza codul de eroare exact.
2. Cauta URL-ul arhivelor JSON C din documentatia oficiala sau din pagina ICCJ.
3. Stabileste classifier-ul pentru empty real vs session/markup fail.
4. Stabileste paginarea `/738` cu fixtures pentru pagina 1 si pagina 2.
5. Masoara TTL cookie si comportamentul la 20-50 POST-uri lente, nu burst.
6. Probeaza 3-4 detalii variate si salveaza fixtures sanitizate.

### V1 recomandat

1. Search interactiv ICCJ pe Vector A.
2. Detaliu lazy la expandare.
3. Export/links source-aware.
4. Fara monitoring ICCJ pe nume.
5. Monitoring ICCJ pe numar dosar doar daca ownerul accepta explicit live website monitoring; altfel amanat.

### Conditii pentru GO pe monitoring live website

1. `ICCJ_LIVE_WEBSITE_MONITORING_ACK=1`.
2. `MONITORING_DISABLED_KINDS=iccj` functioneaza si este documentat.
3. Concurrency 1 pentru `www.scj.ro`.
4. Cadenta minima mare si cap joburi active.
5. Fara snapshot pe rezultat ambiguu.
6. Observabilitate: logs `iccj.source_error`, `iccj.markup_drift`, `iccj.rate_limited`.
7. Teste de regressie pe parser, guard fals-gol, migration CHECK, runner diff si UI link source-aware.

## Concluzie

Fundatia "ICCJ nu este in PortalJust" este solida. Fundatia "folosim Vector A pentru search interactiv" este acceptabila. Fundatia "folosim Vector A si pentru monitoring automat" nu este suficient de solida pentru GO implicit.

Cel mai pragmatic traseu este sa livrezi ICCJ search mai intai, cu infrastructura `iccj.ts` si parserul bine testate, dar sa tii monitoringul ICCJ in spatele unui gate separat. Asta reduce riscul operational si nu blocheaza valoarea imediata pentru user.
